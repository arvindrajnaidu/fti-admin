// Scheduled-delivery helpers.
//
// MIRRORED FROM foodtoindia/lib/scheduling.js — keep both in sync.
//
// All times are wall-clock IST (Asia/Kolkata, UTC+5:30, no DST).
// Slots are 30-minute increments from 8:00 AM to 11:00 PM IST.
// Customers may choose Today, Tomorrow, +2, or +3 days.
//
// Picker rules:
// - Today: hide slots in the past + within next 2 hours from now (IST).
// - Today: hidden entirely once now >= 8:30 PM IST.
// - Tomorrow / +2 / +3: full 8 AM – 11 PM range, no buffer.

const IST_OFFSET_MINUTES = 5 * 60 + 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const SLOT_MS = 30 * 60 * 1000;
const MIN_HOUR = 8;
const MAX_HOUR = 23;
const TODAY_BUFFER_MS = 2 * 60 * 60 * 1000;
const TODAY_CUTOFF_HOUR = 20;
const TODAY_CUTOFF_MINUTE = 30;

const MEAL_WINDOWS = [
  {
    id: 'breakfast',
    label: 'Breakfast',
    displayRange: '8:00-11:00 AM',
    slotMinutes: [480, 510, 540, 570, 600, 630, 660],
  },
  {
    id: 'lunch',
    label: 'Lunch',
    displayRange: '12:00-3:00 PM',
    slotMinutes: [720, 750, 780, 810, 840, 870, 900],
  },
  {
    id: 'snack',
    label: 'Snack',
    displayRange: '4:00-6:00 PM',
    slotMinutes: [960, 990, 1020, 1050, 1080],
  },
  {
    id: 'dinner',
    label: 'Dinner',
    displayRange: '6:00-10:00 PM',
    slotMinutes: [1080, 1110, 1140, 1170, 1200, 1230, 1260, 1290, 1320],
  },
];
const MEAL_WINDOW_BY_ID = Object.fromEntries(MEAL_WINDOWS.map((window) => [window.id, window]));

// Ops-hours window — when our team is actively confirming + dispatching
// orders. Outside this window (9:30 PM – 8:00 AM IST), ASAP isn't a real
// option: a customer who pays at 2 AM IST otherwise sees "~50 min" and gets
// frustrated when the order doesn't move until morning. The picker uses
// these to hide the ASAP radio and force a scheduled-tomorrow flow.
const OPS_HOURS_START_HOUR = 8;          // 8:00 AM IST
const OPS_HOURS_START_MINUTE = 0;
const OPS_HOURS_END_HOUR = 21;           // 9:30 PM IST
const OPS_HOURS_END_MINUTE = 30;

// Convert IST wall-clock {y, m, d, h, min} to a UTC epoch ms.
// IST is UTC+5:30 (no DST), so this is purely arithmetic.
function istWallToEpoch(year, month, day, hour, minute) {
  const utcMs = Date.UTC(year, month, day, hour, minute, 0, 0);
  return utcMs - IST_OFFSET_MINUTES * 60 * 1000;
}

// Convert a UTC epoch ms to IST wall-clock parts.
function epochToIstParts(epochMs) {
  const istMs = epochMs + IST_OFFSET_MINUTES * 60 * 1000;
  const d = new Date(istMs);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
  };
}

// IST midnight (00:00) of the given day (in IST wall-clock), as epoch ms.
function istMidnightEpoch(year, month, day) {
  return istWallToEpoch(year, month, day, 0, 0);
}

// Is `now` (epoch ms) within the ops-hours window (8:00 AM – 9:30 PM IST)?
// Used by the checkout picker to decide whether to offer ASAP at all.
function isWithinOpsHours(now = Date.now()) {
  const ist = epochToIstParts(now);
  const minutes = ist.hour * 60 + ist.minute;
  const startMin = OPS_HOURS_START_HOUR * 60 + OPS_HOURS_START_MINUTE;
  const endMin = OPS_HOURS_END_HOUR * 60 + OPS_HOURS_END_MINUTE;
  return minutes >= startMin && minutes < endMin;
}

// "X:XX AM/PM" — the customer-facing IST time used in the off-hours banner.
function formatIstTimeOfDay(now = Date.now()) {
  const ist = epochToIstParts(now);
  const hour12 = ist.hour === 0 ? 12 : ist.hour > 12 ? ist.hour - 12 : ist.hour;
  const ampm = ist.hour < 12 ? 'AM' : 'PM';
  return `${hour12}:${String(ist.minute).padStart(2, '0')} ${ampm}`;
}

// Generate the IST date options (Today, Tomorrow, +2 … +maxOffset) as
// epoch-ms anchors at IST midnight, plus a label for the picker.
//
// "Today" is omitted entirely when now in IST is past the 8:30 PM cutoff.
//
// Customer flow uses maxOffset=3 (today + 3 future days). Admin ops can
// pass maxOffset=6 to reach a full week — ops sometimes commits a
// delivery several days out from a WhatsApp conversation with the
// recipient.
function getDateOptions(now = Date.now(), maxOffset = 3) {
  const ist = epochToIstParts(now);
  const todayMidnight = istMidnightEpoch(ist.year, ist.month, ist.day);

  const todayCutoffMinutes = TODAY_CUTOFF_HOUR * 60 + TODAY_CUTOFF_MINUTE;
  const nowIstMinutes = ist.hour * 60 + ist.minute;
  const todayOpen = nowIstMinutes < todayCutoffMinutes;

  const opts = [];
  for (let offset = 0; offset <= maxOffset; offset++) {
    if (offset === 0 && !todayOpen) continue;
    const anchor = todayMidnight + offset * DAY_MS;
    const label = labelForOffset(offset, anchor);
    opts.push({ offset, anchor, label });
  }
  return opts;
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function labelForOffset(offset, anchorEpochMs) {
  const parts = epochToIstParts(anchorEpochMs);
  const dateStr = `${MONTH_NAMES[parts.month]} ${parts.day}`;
  // Senders in non-IST timezones see "Today" and assume their local date;
  // the actual scheduled day is IST-relative and can differ by 1. Always
  // surface the IST date alongside the natural-language label.
  if (offset === 0) return `Today, ${dateStr}`;
  if (offset === 1) return `Tomorrow, ${dateStr}`;
  return `${WEEKDAY_NAMES[parts.weekday]}, ${dateStr}`;
}

// Generate the available 30-min slot epochs for a given IST-midnight anchor.
//
// For Today (offset 0): hides slots in the past and within next 2 hours.
// For other days: full 8 AM - 11 PM range.
function getSlotsForAnchor(anchorEpochMs, now = Date.now()) {
  const dayParts = epochToIstParts(anchorEpochMs);
  const todayParts = epochToIstParts(now);
  const isToday =
    dayParts.year === todayParts.year &&
    dayParts.month === todayParts.month &&
    dayParts.day === todayParts.day;

  const minHourEpoch = anchorEpochMs + MIN_HOUR * 60 * 60 * 1000;
  const maxHourEpoch = anchorEpochMs + MAX_HOUR * 60 * 60 * 1000; // inclusive — last slot is 11:00 PM

  const earliestAllowed = isToday ? now + TODAY_BUFFER_MS : minHourEpoch;

  const slots = [];
  for (let t = minHourEpoch; t <= maxHourEpoch; t += SLOT_MS) {
    if (t < earliestAllowed) continue;
    slots.push(t);
  }
  return slots;
}

function getMealWindow(mealWindow) {
  if (typeof mealWindow !== 'string') return null;
  return MEAL_WINDOW_BY_ID[mealWindow] || null;
}

function getSlotsForMealWindow(anchorEpochMs, mealWindow, now = Date.now()) {
  const window = getMealWindow(mealWindow);
  if (!window) return [];
  const validAnchorSlots = new Set(getSlotsForAnchor(anchorEpochMs, now));
  return window.slotMinutes
    .map((minutes) => anchorEpochMs + minutes * 60 * 1000)
    .filter((slot) => validAnchorSlots.has(slot));
}

function getMealWindowsForAnchor(anchorEpochMs, now = Date.now()) {
  return MEAL_WINDOWS.filter((window) => getSlotsForMealWindow(anchorEpochMs, window.id, now).length > 0);
}

// Format an epoch ms as a slot label like "9:00 PM IST".
function formatSlotLabel(epochMs) {
  const p = epochToIstParts(epochMs);
  const hour12 = p.hour === 0 ? 12 : p.hour > 12 ? p.hour - 12 : p.hour;
  const ampm = p.hour < 12 ? 'AM' : 'PM';
  const min = String(p.minute).padStart(2, '0');
  return `${hour12}:${min} ${ampm} IST`;
}

// Format an epoch ms as a customer-facing display string. e.g.
// "Scheduled — Tue Nov 7, 1:00 PM IST".
function formatScheduledDisplay(epochMs) {
  const p = epochToIstParts(epochMs);
  const wd = WEEKDAY_NAMES[p.weekday];
  const mo = MONTH_NAMES[p.month];
  const time = formatSlotLabel(epochMs);
  return `Scheduled - ${wd} ${mo} ${p.day}, ${time}`;
}

function formatDeliveryTimeWithWindow(mealWindow, scheduledForEpochMs) {
  const window = getMealWindow(mealWindow);
  const time = formatSlotLabel(scheduledForEpochMs);
  if (!window) return time;
  return `${window.label} (${time})`;
}

// Hours subtracted from the customer's chosen delivery time to derive
// the recommended "place upstream order at" time shown to ops.
const PLACE_ORDER_LEAD_HOURS = 1;

// Build the multi-line Slack value rendered for ops in the [NEW ORDER]
// channel. Two explicit lines so the dispatcher never has to subtract:
//
//   Place order at Wed, May 6, 12:30 PM IST
//   Expected delivery around Wed, May 6, 1:30 PM IST
//
// The leading 2 spaces of indent on the second line align with the
// existing Handlebars template's "  {{deliveryType}}" line in the
// createOrderDocument Cloud Function — Slack renders a clean column.
function formatSlackDelivery(scheduledForEpochMs) {
  const placeOrderEpoch =
    scheduledForEpochMs - PLACE_ORDER_LEAD_HOURS * 60 * 60 * 1000;

  const fmt = (ms) => {
    const p = epochToIstParts(ms);
    const wd = WEEKDAY_NAMES[p.weekday];
    const mo = MONTH_NAMES[p.month];
    return `${wd}, ${mo} ${p.day}, ${formatSlotLabel(ms)}`;
  };

  return `Place order at ${fmt(placeOrderEpoch)}\n  Expected delivery around ${fmt(scheduledForEpochMs)}`;
}

// Validate a `scheduledFor` epoch ms against the picker's rules.
// Returns { ok: true } or { ok: false, reason }.
function validateScheduledFor(scheduledForMs, now = Date.now()) {
  if (typeof scheduledForMs !== 'number' || !Number.isFinite(scheduledForMs)) {
    return { ok: false, reason: 'invalid_value' };
  }

  // Must be on a 30-min boundary (in UTC ms — equivalent to 30-min boundary
  // in any timezone since IST offset is whole 30-min).
  if (scheduledForMs % SLOT_MS !== 0) {
    return { ok: false, reason: 'not_on_slot_boundary' };
  }

  const p = epochToIstParts(scheduledForMs);
  if (p.hour < MIN_HOUR || p.hour > MAX_HOUR) {
    return { ok: false, reason: 'out_of_hours' };
  }

  // Must be at least 2 hours away from now.
  if (scheduledForMs < now + TODAY_BUFFER_MS) {
    return { ok: false, reason: 'within_2hr' };
  }

  // Must be no more than 96 hours away (today + 3 days).
  if (scheduledForMs > now + 4 * DAY_MS) {
    return { ok: false, reason: 'too_far_out' };
  }

  return { ok: true };
}

function isSlotInMealWindow(scheduledForMs, mealWindow) {
  if (typeof scheduledForMs !== 'number' || !Number.isFinite(scheduledForMs)) return false;
  const window = getMealWindow(mealWindow);
  if (!window) return false;
  const p = epochToIstParts(scheduledForMs);
  return window.slotMinutes.includes(p.hour * 60 + p.minute);
}

function validateMealWindowSlot(scheduledForMs, mealWindow, now = Date.now()) {
  const slotCheck = validateScheduledFor(scheduledForMs, now);
  if (!slotCheck.ok) return slotCheck;
  if (!mealWindow) return { ok: false, reason: 'missing_meal_window' };
  if (!getMealWindow(mealWindow)) return { ok: false, reason: 'invalid_meal_window' };
  if (!isSlotInMealWindow(scheduledForMs, mealWindow)) {
    return { ok: false, reason: 'meal_window_mismatch' };
  }
  return { ok: true };
}

module.exports = {
  IST_OFFSET_MINUTES,
  SLOT_MS,
  MIN_HOUR,
  MAX_HOUR,
  MEAL_WINDOWS,
  TODAY_BUFFER_MS,
  TODAY_CUTOFF_HOUR,
  TODAY_CUTOFF_MINUTE,
  OPS_HOURS_START_HOUR,
  OPS_HOURS_START_MINUTE,
  OPS_HOURS_END_HOUR,
  OPS_HOURS_END_MINUTE,
  istWallToEpoch,
  epochToIstParts,
  getDateOptions,
  getSlotsForAnchor,
  getMealWindowsForAnchor,
  getSlotsForMealWindow,
  formatSlotLabel,
  formatScheduledDisplay,
  formatDeliveryTimeWithWindow,
  formatSlackDelivery,
  validateScheduledFor,
  validateMealWindowSlot,
  isSlotInMealWindow,
  isWithinOpsHours,
  formatIstTimeOfDay,
  PLACE_ORDER_LEAD_HOURS,
};
