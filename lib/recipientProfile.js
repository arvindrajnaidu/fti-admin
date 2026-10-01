// Helpers for the global recipient profile collection.
//
// Path: `recipients/{phoneE164}` — top-level, keyed by recipient phone in
// E.164 format (e.g. "+919003712800"). Independent of the per-user
// `users/{uid}/recipients` collection — same phone may receive food from
// many senders.
//
// Phase 1 scope: confirmation page + ops address editor WRITE here.
// Order-write API does NOT read from here yet (auto-fill is phase 2).
//
// MIRRORED FROM foodtoindia/lib/recipientProfile.js — keep both in sync.

const COLLECTION = 'recipients';

// The 7-field structured address shape stored on profiles AND on
// order.recipientContact.confirmedAddress. Existing recipient.* fields on
// the order doc keep their original 4-field shape — these are new
// locations.
const EMPTY_ADDRESS = {
  doorFlat: '',
  street: '',
  landmark: '',
  area: '',
  city: '',
  state: '',
  pincode: '',
};

const ADDRESS_FIELDS = Object.keys(EMPTY_ADDRESS);

// Normalize whatever address shape we got from a form submission into the
// canonical 7-field shape. Drops unknown keys, coerces to strings, trims.
function normalizeAddress(input) {
  if (!input || typeof input !== 'object') return { ...EMPTY_ADDRESS };
  const out = {};
  for (const field of ADDRESS_FIELDS) {
    const v = input[field];
    out[field] = typeof v === 'string' ? v.trim() : '';
  }
  return out;
}

// Minimum bar to count as "we got something useful". A profile with no
// doorFlat AND no street isn't worth saving — that's just an area string,
// which we already have on the order.
function hasMeaningfulAddress(addr) {
  if (!addr) return false;
  return !!(addr.doorFlat || addr.street);
}

// E.164 sanity check. We never want to write at the wrong key.
function isValidE164(phone) {
  if (typeof phone !== 'string') return false;
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

// Profile doc path. Returns null for an invalid E.164.
function profilePath(phoneE164) {
  if (!isValidE164(phoneE164)) return null;
  return `${COLLECTION}/${phoneE164}`;
}

// Build the upsert payload for a profile write. Caller adds the actual
// `addressUpdatedAt` timestamp — that's environment-specific (admin SDK
// uses `FieldValue.serverTimestamp()`; client SDK uses `serverTimestamp()`
// from a different import).
//
//   source: 'recipient_confirmed' | 'ops_updated'
function buildProfilePayload({ name, address, source, lastOrderId }) {
  return {
    name: typeof name === 'string' ? name.trim() : '',
    confirmedAddress: normalizeAddress(address),
    addressSource: source,
    lastOrderId: lastOrderId || null,
  };
}

module.exports = {
  COLLECTION,
  EMPTY_ADDRESS,
  ADDRESS_FIELDS,
  normalizeAddress,
  hasMeaningfulAddress,
  isValidE164,
  profilePath,
  buildProfilePayload,
};
