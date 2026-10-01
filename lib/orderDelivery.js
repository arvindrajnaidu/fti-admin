// Order delivery helpers shared by the dispatch page (pages/index.js)
// and the ConfirmDeliveryDetailsModal component.

const { formatDeliveryTimeWithWindow, formatSlotLabel } = require('./scheduling');
const { travelerAddressBlockLines } = require('./travelerAddressFormat');

// The consumer app overloads the ORDER doc's recipient.doorNo with the
// Slack handoff line ("room 517\nHandoff: Meet at the lobby / entrance")
// so the fixed order-bot template renders it below "Door No:" without a
// function redeploy (foodtoindia pages/api/orders.js, 2026-07-09). Every
// admin read of order.recipient.doorNo must strip it; the clean handoff
// lives on order.deliveryHandoff. Mirror of foodtoindia lib/orderDisplay.js.
export function stripHandoffSuffix(text) {
  const s = String(text || '');
  if (s.startsWith('Handoff:')) return '';
  return s.split('\nHandoff:')[0].trimEnd();
}

// Builds the clean high-level area string (city + state + pincode +
// country) for the sender_entered path. Prefers addressComponents when
// available (precise pin or area-pick from Google Geocoder), falls back
// to a best-effort cleanup of formattedAddress for legacy recipients.
//
// BugK fix: the legacy formattedAddress can be CORRUPT - re-enrichment
// on every save stamped door/street/landmark into it repeatedly. Strip
// the obvious "Landmark: ..." substrings and dedup against the user-
// typed door/street so the rendered area line stays clean.
function buildAreaLine(recipient) {
  const ac = Array.isArray(recipient?.location?.addressComponents)
    ? recipient.location.addressComponents
    : [];
  if (ac.length > 0) {
    const get = (t) => ac.find((c) => c.types?.includes(t))?.long_name || '';
    return [
      get('sublocality_level_1') || get('sublocality_level_2') || get('sublocality'),
      get('locality') || get('administrative_area_level_2'),
      get('administrative_area_level_1'),
      get('postal_code'),
      get('country'),
    ].filter(Boolean).join(', ');
  }
  // Legacy fallback: strip Landmark: substrings + leading duplicates of
  // the user-typed door/street, then return what's left as the area.
  //
  // F2 fix (v2): the prior fix tried a parts-walker that mistakenly
  // dropped legitimate locality tokens (Bangalore, Karnataka) when the
  // landmark was followed by non-administrative parts. Replaced with:
  //   1. If recipient.landmark is known, strip the exact
  //      "Landmark: <text>" substring - handles landmarks with commas
  //      because we know the exact length.
  //   2. Fall back to the original up-to-first-comma regex for any
  //      remaining "Landmark: ..." stamps where the text doesn't match
  //      recipient.landmark (corrupt / drifted data).
  let raw = recipient?.location?.formattedAddress || '';
  const recipientLandmark = (recipient?.landmark || '').trim();
  if (recipientLandmark) {
    const escaped = recipientLandmark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    raw = raw.replace(new RegExp(`,?\\s*Landmark:\\s*${escaped}`, 'gi'), '');
  }
  raw = raw.replace(/,?\s*Landmark:[^,]*/gi, '').trim();
  const doorTrim = stripHandoffSuffix(recipient?.doorNo).trim();
  const streetTrim = (recipient?.addressLine || '').trim();
  const dedupParts = raw.split(',').map((p) => p.trim()).filter(Boolean)
    .filter((part) => {
      const lower = part.toLowerCase();
      return lower !== doorTrim.toLowerCase() && lower !== streetTrim.toLowerCase();
    });
  return dedupParts.join(', ');
}

// The order's *current* address as far as dispatch is concerned —
// confirmedAddress (set by ops or recipient) overrides the original
// recipient.* fields (the sender's input at checkout). Returns formatted
// display lines plus a `source` tag: 'ops_updated' / 'recipient_confirmed'
// / 'updated' / 'sender_entered'.
//
// Line order (matches the customer-side cart display):
//   Line 1: what the SENDER typed - doorNo + addressLine
//   Line 2: the MAP address - pin's full reverse-geocoded string
//           (location.googleAddress, which preserves building specifics
//           like "Tower 2, Apt: 1021, Olympus, Prestige Acropolis, 20,
//           Hosur Rd, ..."). Falls back to buildAreaLine for legacy
//           recipients whose docs predate googleAddress.
//   Line 3: Landmark, prefixed with "Landmark:"
//
// Each line is independently optional - empty ones drop out of the array.
export function formatCurrentAddress(order) {
  const c = order?.recipientContact?.confirmedAddress;
  if (c && (c.doorFlat || c.street || c.area || c.city)) {
    const lines = [
      [c.doorFlat, c.street].filter(Boolean).join(', '),
      // Ops-confirmed addresses are text-only (no pin), so line 2 is
      // the area/city/state/pincode breakdown.
      [c.area, c.city, c.state, c.pincode].filter(Boolean).join(', '),
      c.landmark ? `Landmark: ${c.landmark}` : '',
    ].filter(Boolean);
    const source = order?.recipientContact?.opsAddressSetAt
      ? 'ops_updated'
      : order?.recipientContact?.status === 'confirmed'
      ? 'recipient_confirmed'
      : 'updated';
    return { lines, source };
  }
  const r = order?.recipient || {};
  // Sender_entered: door+street (typed), then the pin's raw
  // reverse-geocoded address (the same string the customer-side cart
  // displays as line 2), then landmark.
  const pinAddress = r.location?.googleAddress || buildAreaLine(r);
  const lines = [
    [stripHandoffSuffix(r.doorNo), r.addressLine].filter(Boolean).join(', '),
    pinAddress,
    r.landmark ? `Landmark: ${r.landmark}` : '',
  ].filter(Boolean);
  return { lines, source: 'sender_entered' };
}

// Traveler (self_visiting) grouped delivery block for the admin Order Details
// view. Byte-identical to the Slack [NEW ORDER] block the consumer app builds
// (foodtoindia pages/api/orders.js) via the shared lib/travelerAddressFormat.js:
//   <venue label>            e.g. "Hotel / Hostel"
//   <venue name>             recipient.addressLine
//   <full address>           recipient.location.googleAddress (raw Places / composed)
//   <room label>: <doorNo>   e.g. "Room #: 1201" (already labeled by the consumer app)
//   Landmark: <landmark>
// Ops-confirmed addresses fall back to formatCurrentAddress (text-only, no venue).
export function formatTravelerDeliveryLines(order) {
  const c = order?.recipientContact?.confirmedAddress;
  if (c && (c.doorFlat || c.street || c.area || c.city)) {
    return formatCurrentAddress(order);
  }
  const r = order?.recipient || {};
  const blockLines = travelerAddressBlockLines({
    venueType: r.venue_type,
    addressLine: r.addressLine,
    fullAddress: r.location?.googleAddress,
  });
  // doorNo is persisted already labeled ("Room #: 1201") with the Slack handoff
  // suffix appended - strip only the suffix, keep the venue-specific label.
  const roomLine = stripHandoffSuffix(r.doorNo);
  const lines = [
    ...blockLines,
    roomLine,
    r.landmark ? `Landmark: ${r.landmark}` : '',
  ].filter(Boolean);
  return { lines, source: 'sender_entered' };
}

// True when the order is a traveler (self_visiting) order that should use the
// grouped venue block above.
export function isTravelerOrder(order) {
  const r = order?.recipient || {};
  return Boolean(r.venue_type || r.recipientRole === 'traveler' || order?.order_intent === 'self_visiting');
}

// Coordinates for the order's recipient pin, when available. Cascade:
//   1. recipientContact.confirmedPin (recipient dropped a pin on the
//      confirm page via the WhatsApp confirm link - BugL flow)
//   2. recipient.location (sender's pin / area-pick at checkout)
// Returns null when neither path has coordinates.
//
// NOTE: previously this also checked recipientContact.confirmedAddress.
// lat/lng - that was dead code. confirmedAddress is the 7-field TEXT
// shape (doorFlat, street, landmark, area, city, state, pincode) and
// has never had lat/lng on it. Removed.
function pinCoords(order) {
  const cp = order?.recipientContact?.confirmedPin;
  if (cp && typeof cp.lat === 'number' && typeof cp.lng === 'number') {
    return { lat: cp.lat, lng: cp.lng };
  }
  const r = order?.recipient?.location;
  if (r && typeof r.lat === 'number' && typeof r.lng === 'number') {
    return { lat: r.lat, lng: r.lng };
  }
  return null;
}

// Stay truthful: only treat a location as map-worthy when it came from an
// EXPLICIT user action:
//   - Recipient confirmed via the WhatsApp link with a pin
//     (recipientContact.confirmedPin set - BugL flow)
//   - Sender dropped a pin via the v2 form (signal: addressComponents
//     populated on recipient.location)
// Pure area-centroid coords from the legacy LocationModal pick
// (lat / lng but no addressComponents - just a city-zoom centroid from
// Google Geocoder) do NOT count as precise. The user never confirmed
// THAT spot, the geocoder picked it. Showing a map for those would
// imply precision we don't have.
function hasPreciseLocation(order) {
  const cp = order?.recipientContact?.confirmedPin;
  if (cp && typeof cp.lat === 'number' && typeof cp.lng === 'number') return true;
  const r = order?.recipient?.location;
  return Array.isArray(r?.addressComponents) && r.addressComponents.length > 0;
}

// External Google Maps URL (opens in a new tab / native app on mobile).
// Kept as the escape-hatch link inside the inline MapsPreview component.
// Gated on hasPreciseLocation so legacy area-only orders silently get
// no link instead of an inaccurate one.
export function mapsUrlForOrder(order) {
  if (!hasPreciseLocation(order)) return null;
  const c = pinCoords(order);
  // /maps/place/LAT,LNG/@LAT,LNG,18z - Google's own "Share location"
  // format. Reliably centers on the coord with a pin at zoom 18 on
  // desktop and the Maps mobile app. Used by Slack one-tap + admin's
  // "Open in Maps" affordance.
  return c ? `https://www.google.com/maps/place/${c.lat},${c.lng}/@${c.lat},${c.lng},18z` : null;
}

// Embeddable Google Maps URL for an inline iframe. Uses the legacy
// `output=embed` pattern which does NOT require an API key (admin has
// no Google Maps key in env; this keeps things zero-config). Gated on
// hasPreciseLocation - the MapsPreview component returns null when this
// returns null, so the entire map surface (Show map button + iframe)
// disappears for legacy area-only orders.
export function mapsEmbedUrlForOrder(order) {
  if (!hasPreciseLocation(order)) return null;
  const c = pinCoords(order);
  return c ? `https://maps.google.com/maps?q=${c.lat},${c.lng}&z=16&output=embed` : null;
}

// The order's *effective* deliver-at — ops override beats recipient
// confirmation beats the sender's checkout choice. Returns 'asap', an
// epoch-ms number, or null.
export function effectiveDeliverAt(order) {
  const c = order?.recipientContact;
  if (c?.opsConfirmedTimeSlot != null) return c.opsConfirmedTimeSlot;
  if (c?.confirmedTimeSlot != null) return c.confirmedTimeSlot;
  if (order?.scheduling?.scheduledFor != null) return order.scheduling.scheduledFor;
  return null;
}

export function effectiveDeliveryTiming(order) {
  const c = order?.recipientContact;
  const pick = (scheduledFor, mealWindow) => {
    if (scheduledFor === 'asap') return { mode: 'asap', scheduledFor: null, mealWindow: null };
    if (typeof scheduledFor === 'number' && Number.isFinite(scheduledFor)) {
      return { mode: 'scheduled', scheduledFor, mealWindow: mealWindow || null };
    }
    return null;
  };

  return (
    pick(c?.opsConfirmedTimeSlot, c?.opsConfirmedMealWindow) ||
    pick(c?.confirmedTimeSlot, c?.confirmedMealWindow) ||
    pick(order?.scheduling?.scheduledFor, order?.scheduling?.mealWindow) ||
    { mode: 'asap', scheduledFor: null, mealWindow: null }
  );
}

export function formatEffectiveDeliveryTime(order) {
  const timing = effectiveDeliveryTiming(order);
  if (timing.mode !== 'scheduled' || !timing.scheduledFor) return 'ASAP';
  return timing.mealWindow
    ? formatDeliveryTimeWithWindow(timing.mealWindow, timing.scheduledFor)
    : formatSlotLabel(timing.scheduledFor);
}
