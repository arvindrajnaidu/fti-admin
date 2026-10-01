import { db } from '../../lib/firebase';
import { isValidUser } from '../../lib/fraudUsers';
import { paiseToUsd } from '../../lib/currency';
import { requireAuth } from '../../lib/withAuth';

const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL = 5 * 60 * 1000; // 5 min

// The Firestore scan is window-independent (it walks every user's orders
// subcollection regardless of range), so we cache the flattened scan and
// derive each window's report from it in memory. One scan serves every chip.
if (!global.upsellScanCache) {
  global.upsellScanCache = null;
  global.upsellScanCacheTimestamp = null;
}

function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (v.toDate) return v.toDate().getTime();
  if (v instanceof Date) return v.getTime();
  return null;
}

async function scanOrders() {
  const usersSnap = await db.collection('users').get();
  const orders = [];

  const batchSize = 50;
  const userDocs = usersSnap.docs;

  for (let i = 0; i < userDocs.length; i += batchSize) {
    const batch = userDocs.slice(i, i + batchSize);
    await Promise.all(batch.map(async (u) => {
      const email = (u.data().email || '').toLowerCase().trim();
      if (!isValidUser(email)) return;

      const oSnap = await db.collection('users').doc(u.id).collection('orders').get();

      oSnap.forEach((od) => {
        const data = od.data();
        const ms = toMs(data.createdAt);
        if (ms == null) return;

        const items = Object.values(data.lineItems || {});
        const upsellItems = items
          .filter((it) => it.fromUpsell === true)
          .map((it) => {
            const quantity = it.quantity || 1;
            return {
              name: it.name,
              category: it.category || '',
              quantity,
              totalCents: it.itemTotalPrice || it.price * quantity || 0,
            };
          });

        orders.push({
          orderId: od.id,
          uid: u.id,
          createdAtMs: ms,
          upsellItems,
          totalAmountCents: data.totalAmount || 0,
          // Rate for this order, so paise convert correctly across the
          // Rs 95 -> 82 -> 75 -> 71 pricing history.
          rateOrder: { createdAt: ms, conversionPaisePerUsd: data.conversionPaisePerUsd || null },
        });
      });
    }));
  }

  return orders;
}

function buildReport(scan, range) {
  const { startMs, endMs } = range;

  let ordersScanned = 0;
  let totalUpsellUSD = 0;
  const upsellOrders = [];
  const itemTally = {};

  for (const o of scan) {
    if (startMs != null && o.createdAtMs < startMs) continue;
    if (endMs != null && o.createdAtMs > endMs) continue;

    ordersScanned++;
    if (o.upsellItems.length === 0) continue;

    const upsellValueCents = o.upsellItems.reduce((s, it) => s + it.totalCents, 0);
    // Accumulate USD, not paise: totals span the Rs 95 -> 82 -> 75 -> 71
    // pricing history, so one divisor at the end would be wrong.
    totalUpsellUSD += paiseToUsd(upsellValueCents, o.rateOrder);

    upsellOrders.push({
      orderId: o.orderId,
      createdAtMs: o.createdAtMs,
      upsellItems: o.upsellItems.map((it) => ({
        name: it.name,
        category: it.category,
        quantity: it.quantity,
      })),
      upsellValueUSD: paiseToUsd(upsellValueCents, o.rateOrder),
      totalAmountUSD: paiseToUsd(o.totalAmountCents, o.rateOrder),
    });

    for (const it of o.upsellItems) {
      if (!itemTally[it.name]) {
        itemTally[it.name] = { category: it.category, qty: 0, totalUSD: 0 };
      }
      itemTally[it.name].qty += it.quantity;
      itemTally[it.name].totalUSD += paiseToUsd(it.totalCents, o.rateOrder);
    }
  }

  // Sort upsell orders newest-first.
  upsellOrders.sort((a, b) => b.createdAtMs - a.createdAtMs);

  const attachRate = ordersScanned > 0 ? upsellOrders.length / ordersScanned : 0;

  const itemBreakdown = Object.entries(itemTally)
    .map(([name, t]) => ({ name, ...t }))
    .sort((a, b) => b.qty - a.qty);

  return {
    days: range.days,
    rangeLabel: range.rangeLabel,
    startDate: range.startDate || null,
    endDate: range.endDate || null,
    ordersScanned,
    ordersWithUpsell: upsellOrders.length,
    attachRate,
    totalUpsellUSD,
    itemBreakdown,
    orders: upsellOrders,
  };
}

// `new Date('2026-07-28')` parses date-only strings as UTC midnight, which
// snaps to the *previous* local day west of Greenwich. Build the date from
// its parts so a picked date means that calendar date.
function parseLocalDate(s, hours, minutes, seconds, ms) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d, hours, minutes, seconds, ms);
  // Reject rollovers like 2026-02-31 or 2026-13-01.
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

function resolveRange(query) {
  const { startDate, endDate } = query;

  if (startDate || endDate) {
    if (!startDate || !endDate) {
      return { error: 'Both startDate and endDate are required for a custom range' };
    }
    // Validate the calendar dates first so the label and the error messages
    // are right regardless of which boundary source we end up using.
    if (!parseLocalDate(startDate, 0, 0, 0, 0) || !parseLocalDate(endDate, 0, 0, 0, 0)) {
      return { error: 'Invalid startDate or endDate (expected YYYY-MM-DD)' };
    }

    let startMs;
    let endMs;

    if (query.startMs != null || query.endMs != null) {
      // The browser sends the exact epoch boundaries of the picked days in its
      // own timezone. It knows its UTC offset for those specific dates (DST
      // included), so the range means the same calendar days the user saw.
      startMs = Number(query.startMs);
      endMs = Number(query.endMs);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        return { error: 'startMs and endMs must both be epoch milliseconds' };
      }
    } else {
      // Direct API callers (curl, scripts) that send only dates get the
      // server's timezone, which is UTC on Vercel.
      startMs = parseLocalDate(startDate, 0, 0, 0, 0).getTime();
      endMs = parseLocalDate(endDate, 23, 59, 59, 999).getTime();
    }

    if (startMs > endMs) {
      return { error: 'startDate must be on or before endDate' };
    }

    return {
      startMs,
      endMs,
      days: null,
      rangeLabel: `${startDate} to ${endDate}`,
      startDate,
      endDate,
    };
  }

  const days = Math.min(Math.max(parseInt(query.days || '7', 10) || 7, 1), 3650);
  return {
    startMs: Date.now() - days * DAY_MS,
    endMs: null,
    days,
    rangeLabel: `last ${days}d`,
  };
}

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (req.method !== 'GET') return res.status(405).end();

  const range = resolveRange(req.query);
  if (range.error) return res.status(400).json({ error: range.error });

  const force = req.query.forceRefresh === 'true';
  const now = Date.now();

  try {
    let scan = global.upsellScanCache;
    const fresh = scan && now - global.upsellScanCacheTimestamp < CACHE_TTL;

    if (force || !fresh) {
      scan = await scanOrders();
      global.upsellScanCache = scan;
      global.upsellScanCacheTimestamp = now;
    }

    return res.status(200).json(buildReport(scan, range));
  } catch (e) {
    console.error('[upsell-impact]', e);
    return res.status(500).json({ error: e.message });
  }
}
