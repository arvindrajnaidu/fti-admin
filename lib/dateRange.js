// Calendar-day range helpers shared by the admin date pickers and the API
// routes behind them.
//
// The problem: a custom range like "July 3" is a calendar day, and a calendar
// day only has epoch boundaries once you know a timezone. Vercel runs functions
// in UTC, so a server that resolves "July 3" itself gives every viewer the UTC
// day. A Pacific viewer then loses every record created 5pm-midnight their
// time, because those timestamps are already July 4 in UTC. The totals still
// look plausible, which is what makes it dangerous.
//
// The fix: the browser resolves the boundaries. It knows its own UTC offset for
// those specific dates, DST included, so the server needs no tz library and no
// `tz` query param. Clients send `startMs`/`endMs` alongside the human-readable
// `startDate`/`endDate`; the server trusts the epoch values when present and
// falls back to server-local parsing for direct curl/script callers.
//
// Rolling presets (`Date.now() - days * DAY_MS`) are timezone-independent and
// need none of this. Only calendar *anchors* do -- which means the custom-day
// picker and the MTD/QTD/YTD presets, since "this month" has no epoch
// boundaries until you name a timezone either.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const CALENDAR_PRESETS = new Set(['mtd', 'qtd', 'ytd']);

// True for the presets that are anchored to a calendar boundary rather than a
// rolling offset. `days=30` is rolling and needs no timezone; `days=mtd` does.
export function isCalendarPreset(value) {
  return CALENDAR_PRESETS.has(String(value || '').toLowerCase());
}

// --- Client side -----------------------------------------------------------

// Local-date ISO (YYYY-MM-DD) for a Date. `toISOString()` would render the UTC
// date, which is the previous or next day for most of the world's viewers.
export function toIsoDate(d) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

// Epoch boundaries of a picked calendar day in the viewer's own timezone.
export function dayStartMs(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

export function dayEndMs(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

// The query params for a custom range: the dates for display/caching, plus the
// viewer-resolved epoch boundaries the server should actually filter on.
export function customRangeParams(startIso, endIso) {
  return {
    startDate: startIso,
    endDate: endIso,
    startMs: String(dayStartMs(startIso)),
    endMs: String(dayEndMs(endIso)),
  };
}

// Boundaries of a calendar-anchored preset, resolved in whatever timezone the
// caller is running in. In the browser that is the viewer's zone, which is the
// point; on the server it is the server's, which is the documented fallback
// for direct curl/script callers. Same function either way -- the only thing
// that differs is whose midnight `new Date(y, m, d)` means.
//
// `prevStartMs` is part of the contract because MTD's comparison period is the
// *1st of the previous month*, a calendar anchor in its own right. The server
// cannot derive that from `startMs` without knowing the zone, so the caller
// that does know sends it. QTD/YTD subtract the elapsed duration instead,
// preserving the behaviour those two presets already had.
export function presetRangeMs(preset, now = new Date()) {
  const p = String(preset || '').toLowerCase();
  if (!CALENDAR_PRESETS.has(p)) return null;

  const year = now.getFullYear();
  const month = now.getMonth();
  // End of "today" in the same zone the start is anchored to, so a preset can
  // never span a partial day at one end and a whole one at the other.
  const endMs = new Date(year, month, now.getDate(), 23, 59, 59, 999).getTime();

  let startMs;
  let prevStartMs;
  if (p === 'mtd') {
    startMs = new Date(year, month, 1, 0, 0, 0, 0).getTime();
    // month - 1 rolls back across January correctly.
    prevStartMs = new Date(year, month - 1, 1, 0, 0, 0, 0).getTime();
  } else if (p === 'qtd') {
    startMs = new Date(year, Math.floor(month / 3) * 3, 1, 0, 0, 0, 0).getTime();
    prevStartMs = startMs - (endMs - startMs);
  } else {
    startMs = new Date(year, 0, 1, 0, 0, 0, 0).getTime();
    prevStartMs = startMs - (endMs - startMs);
  }

  return { preset: p, startMs, endMs, prevStartMs };
}

// The query params for a calendar preset: the preset name the server switches
// on, plus the boundaries the viewer's browser resolved for it.
export function presetRangeParams(preset, now = new Date()) {
  const r = presetRangeMs(preset, now);
  if (!r) return null;
  return {
    days: r.preset,
    startMs: String(r.startMs),
    endMs: String(r.endMs),
    prevStartMs: String(r.prevStartMs),
  };
}

// --- Shared filter set -----------------------------------------------------

// The canonical admin date-filter chips. Every page's picker starts from this
// list so the four sets cannot drift apart again. Pages whose surface genuinely
// needs more append to it: Analytics adds MTD/QTD, Orders adds All.
export const STANDARD_RANGES = ['Last 7d', '1 month', '3 months', 'Last 1y', 'YTD', 'Custom'];

const RANGE_SPECS = {
  // Ops works the recent queue. 'Last 3d' is the default landing view; the
  // wider ranges are still a click away.
  'Last 3d': { days: '3' },
  'Last 7d': { days: '7' },
  '1 month': { days: '30' },
  '3 months': { days: '90' },
  'Last 1y': { days: '365' },
  YTD: { preset: 'ytd' },
  MTD: { preset: 'mtd' },
  QTD: { preset: 'qtd' },
  All: { days: 'all' },
  Custom: { custom: true },
};

export function isCustomRangeLabel(label) {
  return RANGE_SPECS[label]?.custom === true;
}

// Date pickers hand back two different shapes: Kumo's returns Date objects,
// native <input type="date"> returns 'YYYY-MM-DD' strings. Pass an already-ISO
// string straight through -- running it through toIsoDate would parse it as UTC
// midnight and roll it back a day for every viewer west of Greenwich.
const asIsoDate = (v) => {
  const s = String(v ?? '').trim();
  return ISO_DATE.test(s) ? s : toIsoDate(v);
};

// Query params for a selected chip, resolved in the viewer's timezone.
//
// `custom` is the {from, to} the date picker produced, read only for 'Custom'.
//
// `nativePresets` says whether the target API has its own mtd/qtd/ytd branch.
// Only /api/analytics/kpis does, and it must use it: MTD's comparison period
// there is the *whole previous month*, which the custom-range path (start minus
// elapsed duration) would quietly redefine. Everywhere else a calendar preset
// is sent as a custom range, which every route already resolves from
// startMs/endMs -- so no other API needs a preset branch at all.
export function rangeQueryParams(label, { custom, nativePresets = false } = {}) {
  const spec = RANGE_SPECS[label];
  if (!spec) return null;

  if (spec.custom) {
    const from = asIsoDate(custom?.from);
    const to = asIsoDate(custom?.to);
    if (!from || !to) return null;
    return customRangeParams(from, to);
  }
  if (spec.days) return { days: spec.days };

  if (nativePresets) return presetRangeParams(spec.preset);
  const { startMs, endMs } = presetRangeMs(spec.preset);
  return customRangeParams(toIsoDate(new Date(startMs)), toIsoDate(new Date(endMs)));
}

// --- Server side -----------------------------------------------------------

// `new Date('2026-07-03')` parses date-only strings as UTC midnight, which
// snaps to the *previous* local day west of Greenwich. Build the date from its
// parts so a picked date means that calendar date.
export function parseLocalDate(s, hours = 0, minutes = 0, seconds = 0, ms = 0) {
  const m = ISO_DATE.exec(String(s || '').trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d, hours, minutes, seconds, ms);
  // Reject rollovers like 2026-02-31 or 2026-13-01.
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

// Resolve a custom range from a request query into epoch boundaries.
// Returns `{ startMs, endMs, startDate, endDate, viewerResolved }`, or
// `{ error }` when the range is unusable.
export function resolveCustomRange(query) {
  const { startDate, endDate } = query;

  if (!startDate || !endDate) {
    return { error: 'Both startDate and endDate are required for a custom range' };
  }
  // Validate the calendar dates first so error messages are right regardless of
  // which boundary source we end up using.
  if (!parseLocalDate(startDate) || !parseLocalDate(endDate)) {
    return { error: 'Invalid startDate or endDate (expected YYYY-MM-DD)' };
  }

  let startMs;
  let endMs;
  let viewerResolved = false;

  if (query.startMs != null || query.endMs != null) {
    // The browser sends the exact epoch boundaries of the picked days in its
    // own timezone. It knows its UTC offset for those specific dates (DST
    // included), so the range means the same calendar days the user saw.
    startMs = Number(query.startMs);
    endMs = Number(query.endMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return { error: 'startMs and endMs must both be epoch milliseconds' };
    }
    viewerResolved = true;
  } else {
    // Direct API callers (curl, scripts) that send only dates get the server's
    // timezone, which is UTC on Vercel.
    startMs = parseLocalDate(startDate, 0, 0, 0, 0).getTime();
    endMs = parseLocalDate(endDate, 23, 59, 59, 999).getTime();
  }

  if (startMs > endMs) {
    return { error: 'startDate must be on or before endDate' };
  }

  return { startMs, endMs, startDate, endDate, viewerResolved };
}

// Resolve a calendar preset (mtd/qtd/ytd) from a request query into epoch
// boundaries. Returns `{ preset, startMs, endMs, prevStartMs, viewerResolved }`,
// or `{ error }` when the request is unusable.
export function resolvePresetRange(preset, query = {}, now = new Date()) {
  const serverLocal = presetRangeMs(preset, now);
  if (!serverLocal) {
    return { error: `Unknown preset "${preset}" (expected mtd, qtd or ytd)` };
  }

  const sent = ['startMs', 'endMs', 'prevStartMs'].filter((k) => query[k] != null);
  if (sent.length === 0) {
    // Direct API callers (curl, scripts) that send only the preset name get the
    // server's timezone, which is UTC on Vercel.
    return { ...serverLocal, viewerResolved: false };
  }
  // Partial boundaries would silently mix the viewer's zone with the server's,
  // which is the exact failure this module exists to prevent.
  if (sent.length !== 3) {
    return { error: 'startMs, endMs and prevStartMs must be sent together' };
  }

  const startMs = Number(query.startMs);
  const endMs = Number(query.endMs);
  const prevStartMs = Number(query.prevStartMs);
  if (![startMs, endMs, prevStartMs].every(Number.isFinite)) {
    return { error: 'startMs, endMs and prevStartMs must be epoch milliseconds' };
  }
  if (startMs > endMs) {
    return { error: 'startMs must be on or before endMs' };
  }
  if (prevStartMs > startMs) {
    return { error: 'prevStartMs must be on or before startMs' };
  }

  return { preset: serverLocal.preset, startMs, endMs, prevStartMs, viewerResolved: true };
}

// Cache keys must carry the resolved boundaries, not just the dates. Two
// viewers in different timezones picking "July 3" get different epoch ranges
// and must not share a cache entry.
export function rangeCacheSuffix(range) {
  return `${range.startDate}_${range.endDate}_${range.startMs}_${range.endMs}`;
}

// Same rule for presets: "MTD" names different windows in different zones, and
// the previous-period boundary feeds the response too, so all three go in.
export function presetCacheSuffix(range) {
  return `${range.preset}_${range.startMs}_${range.endMs}_${range.prevStartMs}`;
}
