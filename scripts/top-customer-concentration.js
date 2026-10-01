// Monthly customer report.
//
// Sections:
//   1. Top-customer concentration (P1 recent vs P2 historic, top-8 share)
//   2. Growth accounting (P1 revenue split: new / returning / resurrected,
//      plus Lost as a separate counterfactual estimate)
//   3. Early-lapse warning (high-LTV customers whose recent order rate
//      has fallen significantly below their personal baseline — actionable
//      list of names to send win-back to TODAY)
//   4. Cohort comparison (post-Feb-2026 acquisition vs pre-improvement
//      baseline cohort, both measured at equivalent age — does the Feb 2026
//      product/UX improvement show up in retention/spend metrics?)
//
// Reads Firestore directly via Admin SDK; loads .env.local (same pattern
// as scripts/test-resend-sdk.js). Filters fraud users via lib/fraudUsers.
//
// Run from admin/:
//   NODE_OPTIONS='--openssl-legacy-provider' node scripts/top-customer-concentration.js

const fs = require('fs');
const path = require('path');

// Load .env.local
try {
  const envFile = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
  envFile.split('\n').forEach((line) => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) return;
    let val = m[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    process.env[m[1].trim()] = val;
  });
} catch (e) {
  console.error('Could not read .env.local:', e.message);
  process.exit(1);
}

const { db } = require('../lib/firebase');
const { isValidUser } = require('../lib/fraudUsers');

// Test/internal accounts the user wants excluded from analysis.
// Not "fraud" per se but pollute the customer cohort numbers.
const TEST_ACCOUNTS = new Set([
  'ath.sub.007@gmail.com',
  'trackwork.contact@gmail.com',
  'athahar+f1@gmail.com',
]);

// Optional PostHog attribution CSV — if present, joined onto customers by email
// and surfaced in the deep-dive sections (5, 6). Path is the user's local export.
const ATTRIBUTION_CSV = '/Users/athahar/Downloads/source-of-conversion-export-2026-05-07-060338.csv';

// ==== Configuration ====
// Window boundaries — roll forward each month.
const PERIOD1_START = new Date('2025-12-01T00:00:00Z');
const PERIOD1_END   = new Date('2026-05-01T00:00:00Z');
const PERIOD1_MONTHS = 5;

// For growth accounting — how long since last order before we call a
// customer "lapsed" (vs. just steady-with-gap).
const LAPSE_THRESHOLD_DAYS = 90;

// Early-lapse warning thresholds.
const LAPSE_WARN_MIN_LTV_USD = 300;        // only flag customers worth recovering
const LAPSE_WARN_BASELINE_MIN_ORDERS = 4;  // need history to compute a baseline
const LAPSE_WARN_RECENT_RATIO_THRESHOLD = 0.3;  // flag if recent rate < 30% of baseline
const LAPSE_WARN_TOP_N = 20;

// Post-Feb cohort: acquisition windows + comparison age.
const POST_FEB_COHORT_START = new Date('2026-02-01T00:00:00Z');
const POST_FEB_COHORT_END   = new Date('2026-03-01T00:00:00Z');
const PRIOR_COHORT_START    = new Date('2025-10-01T00:00:00Z');
const PRIOR_COHORT_END      = new Date('2025-11-01T00:00:00Z');
const COHORT_OBSERVATION_DAYS = 90;  // first N days of customer life

const TOP_N = 8;

// totalAmount in Firestore is USD * 10000.
const formatUSD = (n) => `$${(n / 10000).toFixed(2)}`;
const pct = (n) => `${(n * 100).toFixed(1)}%`;
const DAY_MS = 1000 * 60 * 60 * 24;
const MONTH_MS = DAY_MS * 30.4375;

// ==== Data load ====
async function loadCustomers() {
  console.log(`Reading users from Firestore project ${process.env.FIREBASE_ENV === 'production' ? 'foodtoindia (PROD)' : 'foodtoindia-dev'}...`);
  const usersSnap = await db.collection('users').get();
  console.log(`Got ${usersSnap.size} users. Reading orders for each...`);

  const customers = [];  // { email, name, orders: [{createdAtMs, totalAmount}], firstMs, lastMs, lifetime, count }

  let processed = 0;
  let fraudSkipped = 0;
  const batchSize = 50;
  const userDocs = usersSnap.docs;

  for (let i = 0; i < userDocs.length; i += batchSize) {
    const batch = userDocs.slice(i, i + batchSize);
    await Promise.all(batch.map(async (userDoc) => {
      const userId = userDoc.id;
      const userData = userDoc.data();
      const email = (userData?.email || '').toLowerCase().trim();
      if (!email) return;
      if (!isValidUser(email) || TEST_ACCOUNTS.has(email)) {
        fraudSkipped += 1;
        return;
      }

      const ordersSnap = await db
        .collection('users')
        .doc(userId)
        .collection('orders')
        .get();

      const orders = [];
      ordersSnap.forEach((orderDoc) => {
        const o = orderDoc.data();
        let ms = null;
        if (typeof o.createdAt === 'number') ms = o.createdAt;
        else if (o.createdAt?.toDate) ms = o.createdAt.toDate().getTime();
        else if (o.createdAt instanceof Date) ms = o.createdAt.getTime();
        if (ms == null) return;
        orders.push({
          createdAtMs: ms,
          totalAmount: o.totalAmount || 0,
          recipientName: o.recipient?.name || o.recipientName || null,
          restaurantName: o.restaurant?.name || o.restaurantName || null,
        });
      });
      if (orders.length === 0) return;
      orders.sort((a, b) => a.createdAtMs - b.createdAtMs);

      const lifetime = orders.reduce((s, o) => s + o.totalAmount, 0);
      const firstMs = orders[0].createdAtMs;
      const lastMs = orders[orders.length - 1].createdAtMs;
      const name = userData.displayName || userData.name || email;

      // Capture win-back send timestamp so resurrectable-lost can exclude
      // customers we've already tried.
      let winbackSentMs = null;
      const wbSentAt = userData.engagementHistory?.winback?.sentAt;
      if (wbSentAt) {
        if (typeof wbSentAt.toDate === 'function') winbackSentMs = wbSentAt.toDate().getTime();
        else if (typeof wbSentAt === 'number') winbackSentMs = wbSentAt;
        else if (wbSentAt._seconds) winbackSentMs = wbSentAt._seconds * 1000;
      }

      customers.push({ email, name, orders, firstMs, lastMs, lifetime, count: orders.length, winbackSentMs });
    }));
    processed += batch.length;
    if (processed % 200 === 0 || processed === userDocs.length) {
      console.log(`  ...${processed}/${userDocs.length}`);
    }
  }

  console.log(`Customers with orders: ${customers.length} (fraud filtered: ${fraudSkipped})`);
  return customers;
}

// ==== Section 1: Top-customer concentration ====
function section1Concentration(customers) {
  const period1 = new Map();
  const period2 = new Map();
  let p2EarliestMs = Infinity;

  for (const c of customers) {
    let p1 = 0, p1c = 0, p2 = 0, p2c = 0;
    for (const o of c.orders) {
      if (o.createdAtMs >= PERIOD1_START.getTime() && o.createdAtMs < PERIOD1_END.getTime()) {
        p1 += o.totalAmount; p1c += 1;
      } else if (o.createdAtMs < PERIOD1_START.getTime()) {
        p2 += o.totalAmount; p2c += 1;
        if (o.createdAtMs < p2EarliestMs) p2EarliestMs = o.createdAtMs;
      }
    }
    if (p1 > 0) period1.set(c.email, { name: c.name, total: p1, count: p1c });
    if (p2 > 0) period2.set(c.email, { name: c.name, total: p2, count: p2c });
  }

  const period2EarliestDate = new Date(p2EarliestMs);
  const period2Months = (PERIOD1_START - period2EarliestDate) / MONTH_MS;
  const sortedP1 = [...period1.entries()].sort((a, b) => b[1].total - a[1].total);
  const sortedP2 = [...period2.entries()].sort((a, b) => b[1].total - a[1].total);
  const top1 = sortedP1.slice(0, TOP_N);
  const top2 = sortedP2.slice(0, TOP_N);
  const totalP1 = sortedP1.reduce((s, [, v]) => s + v.total, 0);
  const totalP2 = sortedP2.reduce((s, [, v]) => s + v.total, 0);
  const top1Sum = top1.reduce((s, [, v]) => s + v.total, 0);
  const top2Sum = top2.reduce((s, [, v]) => s + v.total, 0);

  console.log();
  console.log('============================================================');
  console.log(' SECTION 1 — Top-customer concentration');
  console.log('============================================================');
  console.log();
  console.log(`Period 1: ${PERIOD1_START.toISOString().slice(0, 10)} → ${PERIOD1_END.toISOString().slice(0, 10)} (${PERIOD1_MONTHS} months)`);
  console.log(`  Customers w/ orders   : ${sortedP1.length}`);
  console.log(`  Total revenue         : ${formatUSD(totalP1)}`);
  console.log(`  Top ${TOP_N} share          : ${pct(top1Sum / totalP1)}  (${formatUSD(top1Sum)})`);
  console.log(`  Per-month run rate    : ${formatUSD(totalP1 / PERIOD1_MONTHS)}`);
  console.log('  Top 8:');
  top1.forEach(([email, v], i) => {
    console.log(`    ${(i + 1).toString().padStart(2)}. ${v.name.padEnd(28)} ${email.padEnd(36)} ${String(v.count).padStart(4)} orders   ${formatUSD(v.total).padStart(10)}`);
  });

  console.log();
  console.log(`Period 2: ${period2EarliestDate.toISOString().slice(0, 10)} → ${PERIOD1_START.toISOString().slice(0, 10)} (~${period2Months.toFixed(1)} months)`);
  console.log(`  Customers w/ orders   : ${sortedP2.length}`);
  console.log(`  Total revenue         : ${formatUSD(totalP2)}`);
  console.log(`  Top ${TOP_N} share          : ${pct(top2Sum / totalP2)}  (${formatUSD(top2Sum)})`);
  console.log(`  Per-month run rate    : ${formatUSD(totalP2 / period2Months)}`);
  console.log('  Top 8:');
  top2.forEach(([email, v], i) => {
    console.log(`    ${(i + 1).toString().padStart(2)}. ${v.name.padEnd(28)} ${email.padEnd(36)} ${String(v.count).padStart(4)} orders   ${formatUSD(v.total).padStart(10)}`);
  });

  console.log();
  const delta = (top1Sum / totalP1) - (top2Sum / totalP2);
  console.log(`Top-${TOP_N} share change: ${pct(top2Sum / totalP2)} → ${pct(top1Sum / totalP1)}  (Δ ${delta >= 0 ? '+' : ''}${pct(delta)})`);
  console.log(`Run-rate change      : ${formatUSD(totalP2 / period2Months)} → ${formatUSD(totalP1 / PERIOD1_MONTHS)} per month (${((totalP1 / PERIOD1_MONTHS) / (totalP2 / period2Months)).toFixed(2)}×)`);
}

// ==== Section 2: Growth accounting ====
function section2GrowthAccounting(customers) {
  const p1Start = PERIOD1_START.getTime();
  const p1End = PERIOD1_END.getTime();
  const lapseCutoff = p1Start - LAPSE_THRESHOLD_DAYS * DAY_MS;

  let newRev = 0, newCount = 0;            // first order in P1
  let returningRev = 0, returningCount = 0; // P2 orders ending within 90d of P1 start
  let resurrectedRev = 0, resurrectedCount = 0; // P2 orders ended >90d before P1 start
  let lostRev = 0, lostCount = 0;          // had P2 orders, zero P1 orders
  let lostP1Equivalent = 0;                // counterfactual: their last 5mo of P2 spend

  for (const c of customers) {
    const p1Orders = c.orders.filter((o) => o.createdAtMs >= p1Start && o.createdAtMs < p1End);
    const p2Orders = c.orders.filter((o) => o.createdAtMs < p1Start);
    const p1Spend = p1Orders.reduce((s, o) => s + o.totalAmount, 0);
    const p2Spend = p2Orders.reduce((s, o) => s + o.totalAmount, 0);

    if (p1Spend === 0 && p2Spend === 0) continue;

    if (p1Spend > 0 && p2Spend === 0) {
      // First order ever was in P1
      newRev += p1Spend;
      newCount += 1;
    } else if (p1Spend > 0 && p2Spend > 0) {
      // Active in both. Distinguish steady vs resurrected by gap before P1.
      const lastP2Ms = Math.max(...p2Orders.map((o) => o.createdAtMs));
      if (lastP2Ms >= lapseCutoff) {
        returningRev += p1Spend;
        returningCount += 1;
      } else {
        resurrectedRev += p1Spend;
        resurrectedCount += 1;
      }
    } else {
      // p2Spend > 0, p1Spend === 0 — Lost.
      lostCount += 1;
      // Counterfactual: their P2 last-5-month spend (matches P1 length)
      const p1Length = p1End - p1Start;
      const counterfactualStart = p1Start - p1Length;
      const last5moOfP2 = p2Orders
        .filter((o) => o.createdAtMs >= counterfactualStart && o.createdAtMs < p1Start)
        .reduce((s, o) => s + o.totalAmount, 0);
      lostP1Equivalent += last5moOfP2;
      lostRev += p2Spend;  // keep total p2 for context
    }
  }

  const p1Total = newRev + returningRev + resurrectedRev;

  console.log();
  console.log('============================================================');
  console.log(' SECTION 2 — Growth accounting (P1 revenue decomposition)');
  console.log('============================================================');
  console.log();
  console.log(`P1 total revenue: ${formatUSD(p1Total)}`);
  console.log();
  console.log(`  ${'New customers'.padEnd(28)} ${formatUSD(newRev).padStart(10)}  (${pct(newRev / p1Total)})  — ${newCount} customers, first order in P1`);
  console.log(`  ${'Returning (steady)'.padEnd(28)} ${formatUSD(returningRev).padStart(10)}  (${pct(returningRev / p1Total)})  — ${returningCount} customers, P2 orders within ${LAPSE_THRESHOLD_DAYS}d of P1 start`);
  console.log(`  ${'Resurrected'.padEnd(28)} ${formatUSD(resurrectedRev).padStart(10)}  (${pct(resurrectedRev / p1Total)})  — ${resurrectedCount} customers, P2 last order >${LAPSE_THRESHOLD_DAYS}d before P1 start, came back in P1`);
  console.log();
  console.log(`Lost (no P1 orders, was active in P2):`);
  console.log(`  Customer count             : ${lostCount}`);
  console.log(`  Last-5mo-of-P2 counterfactual: ${formatUSD(lostP1Equivalent)}  ← what these customers would have spent in P1 if they'd kept their P2 pace`);
  console.log(`  Net effective growth (P1 - counterfactual lost): ${formatUSD(p1Total - lostP1Equivalent)}`);
}

// ==== Section 3: Early-lapse warning ====
function section3EarlyLapseWarning(customers) {
  const now = Date.now();
  const ninetyDaysAgo = now - 90 * DAY_MS;
  const minLtvCents = LAPSE_WARN_MIN_LTV_USD * 10000;

  const candidates = [];
  for (const c of customers) {
    if (c.lifetime < minLtvCents) continue;
    if (c.count < LAPSE_WARN_BASELINE_MIN_ORDERS) continue;

    // Personal baseline: orders/month over (lifetime up to 90 days ago)
    const baselineCutoff = now - 90 * DAY_MS;
    const baselineOrders = c.orders.filter((o) => o.createdAtMs < baselineCutoff);
    if (baselineOrders.length < LAPSE_WARN_BASELINE_MIN_ORDERS) continue;
    const baselineSpanMs = baselineCutoff - baselineOrders[0].createdAtMs;
    const baselineMonths = baselineSpanMs / MONTH_MS;
    if (baselineMonths < 1) continue;
    const baselineRate = baselineOrders.length / baselineMonths;  // orders / month

    // Recent: last 90 days
    const recentOrders = c.orders.filter((o) => o.createdAtMs >= ninetyDaysAgo);
    const recentMonths = 3; // 90 days ≈ 3 months
    const recentRate = recentOrders.length / recentMonths;

    const ratio = baselineRate > 0 ? recentRate / baselineRate : 0;
    if (ratio >= LAPSE_WARN_RECENT_RATIO_THRESHOLD) continue;

    // Skip already-fully-lapsed (not actionable via win-back) — those are
    // the lost bucket. Focus on warm-but-fading: at least one order in the
    // last 60 days OR multiple in last 120 days.
    const sixtyDaysAgo = now - 60 * DAY_MS;
    const oneTwentyDaysAgo = now - 120 * DAY_MS;
    const recent60 = c.orders.filter((o) => o.createdAtMs >= sixtyDaysAgo).length;
    const recent120 = c.orders.filter((o) => o.createdAtMs >= oneTwentyDaysAgo).length;
    if (recent60 === 0 && recent120 < 2) continue;

    // Severity = lifetime spend × (1 - ratio). Bigger spenders falling
    // further get prioritized.
    const severity = c.lifetime * (1 - ratio);
    candidates.push({
      ...c,
      baselineRate,
      recentRate,
      ratio,
      recent60,
      recent120,
      severity,
    });
  }

  candidates.sort((a, b) => b.severity - a.severity);

  console.log();
  console.log('============================================================');
  console.log(' SECTION 3 — Early-lapse warning (fading whales — send win-back NOW)');
  console.log('============================================================');
  console.log();
  console.log(`Criteria: lifetime spend ≥ $${LAPSE_WARN_MIN_LTV_USD}, ≥${LAPSE_WARN_BASELINE_MIN_ORDERS} historical orders, last-90d order rate < ${pct(LAPSE_WARN_RECENT_RATIO_THRESHOLD)} of personal baseline, still warm (≥1 order in last 60d OR ≥2 in last 120d).`);
  console.log();
  console.log(`Found ${candidates.length} candidates. Top ${LAPSE_WARN_TOP_N}:`);
  console.log();
  console.log('   #  Name                          Email                                Lifetime   Baseline    Recent  Drop');
  candidates.slice(0, LAPSE_WARN_TOP_N).forEach((c, i) => {
    console.log(`  ${(i + 1).toString().padStart(2)}. ${c.name.padEnd(28).slice(0, 28)}  ${c.email.padEnd(35).slice(0, 35)}  ${formatUSD(c.lifetime).padStart(8)}  ${c.baselineRate.toFixed(2)}/mo    ${c.recentRate.toFixed(2)}/mo  ${pct(1 - c.ratio).padStart(6)}`);
  });
}

// ==== Section 4: Cohort comparison (post-Feb vs pre-improvement) ====
function section4CohortComparison(customers) {
  const obsMs = COHORT_OBSERVATION_DAYS * DAY_MS;

  function cohortMetrics(cohortStart, cohortEnd, label) {
    const members = customers.filter((c) => {
      return c.firstMs >= cohortStart.getTime() && c.firstMs < cohortEnd.getTime();
    });

    let total2plus = 0;
    let totalOrdersInWindow = 0;
    let totalSpendInWindow = 0;
    const reorderGapsMs = [];

    for (const c of members) {
      const observationEnd = c.firstMs + obsMs;
      const ordersInWindow = c.orders.filter((o) => o.createdAtMs >= c.firstMs && o.createdAtMs < observationEnd);
      totalOrdersInWindow += ordersInWindow.length;
      totalSpendInWindow += ordersInWindow.reduce((s, o) => s + o.totalAmount, 0);
      if (ordersInWindow.length >= 2) {
        total2plus += 1;
        reorderGapsMs.push(ordersInWindow[1].createdAtMs - ordersInWindow[0].createdAtMs);
      }
    }

    const n = members.length;
    const avgOrders = n > 0 ? totalOrdersInWindow / n : 0;
    const avgSpend = n > 0 ? totalSpendInWindow / n : 0;
    const reorderRate = n > 0 ? total2plus / n : 0;
    const avgReorderGapDays = reorderGapsMs.length > 0
      ? reorderGapsMs.reduce((s, x) => s + x, 0) / reorderGapsMs.length / DAY_MS
      : null;

    return { label, n, avgOrders, avgSpend, reorderRate, avgReorderGapDays };
  }

  const post = cohortMetrics(POST_FEB_COHORT_START, POST_FEB_COHORT_END, 'Post-improvement (Feb 2026)');
  const prior = cohortMetrics(PRIOR_COHORT_START, PRIOR_COHORT_END, 'Pre-improvement (Oct 2025)');

  console.log();
  console.log('============================================================');
  console.log(' SECTION 4 — Cohort comparison (did Feb 2026 product/UX moves the needle?)');
  console.log('============================================================');
  console.log();
  console.log(`Both cohorts measured at ${COHORT_OBSERVATION_DAYS} days from each customer's first order — apples-to-apples.`);
  console.log();
  const fmt = (label, postVal, priorVal, formatter) => {
    const ps = formatter(postVal);
    const prs = formatter(priorVal);
    const delta = (postVal - priorVal) / (priorVal || 1);
    const arrow = postVal > priorVal ? '↑' : (postVal < priorVal ? '↓' : '–');
    return `  ${label.padEnd(34)} ${ps.padStart(10)}     ${prs.padStart(10)}     ${arrow} ${pct(Math.abs(delta))}`;
  };

  console.log(`  ${''.padEnd(34)} ${'Feb 2026'.padStart(10)}     ${'Oct 2025'.padStart(10)}     Δ`);
  console.log(`  ${'Customers acquired'.padEnd(34)} ${String(post.n).padStart(10)}     ${String(prior.n).padStart(10)}`);
  console.log(fmt('Avg orders / customer (90d)', post.avgOrders, prior.avgOrders, (n) => n.toFixed(2)));
  console.log(fmt('Avg spend / customer (90d)', post.avgSpend, prior.avgSpend, formatUSD));
  console.log(fmt('% who placed 2+ orders', post.reorderRate, prior.reorderRate, pct));
  if (post.avgReorderGapDays != null && prior.avgReorderGapDays != null) {
    console.log(fmt('Avg days to 2nd order', post.avgReorderGapDays, prior.avgReorderGapDays, (n) => `${n.toFixed(1)}d`));
  }
  console.log();
  if (post.reorderRate > prior.reorderRate) {
    console.log(`→ Post-Feb cohort reorders at a HIGHER rate. Consistent with product/UX improvement.`);
  } else {
    console.log(`→ Post-Feb cohort reorders at a LOWER rate. Product improvement hasn't yet shown up in retention metrics — may need more observation time, or the improvement isn't moving this metric.`);
  }
}

// ==== PostHog attribution loader ====
function loadAttribution() {
  try {
    const raw = fs.readFileSync(ATTRIBUTION_CSV, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length < 2) return new Map();
    const header = lines[0].split(',').map((s) => s.trim());
    const idx = (name) => header.indexOf(name);
    const eIdx = idx('email');
    const rIdx = idx('referring_domain');
    const sIdx = idx('utm_source');
    const cIdx = idx('utm_campaign');
    const cityIdx = idx('city');
    const countryIdx = idx('country');
    const fIdx = idx('first_order_date');
    const map = new Map();
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const email = (cols[eIdx] || '').toLowerCase().trim();
      if (!email) continue;
      map.set(email, {
        referringDomain: cols[rIdx] || '',
        utmSource: cols[sIdx] || '',
        utmCampaign: cols[cIdx] || '',
        city: cols[cityIdx] || '',
        country: cols[countryIdx] || '',
        firstOrderDate: cols[fIdx] || '',
      });
    }
    console.log(`Loaded attribution for ${map.size} emails from PostHog CSV`);
    return map;
  } catch (e) {
    console.warn(`(no attribution CSV found at ${ATTRIBUTION_CSV} — skipping enrichment)`);
    return new Map();
  }
}

function topItem(items) {
  // items is an object email/string -> count. Returns "name (count)" of top by count.
  const entries = Object.entries(items);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return `${entries[0][0]} (${entries[0][1]})`;
}

function aggRecipientsRestaurants(customer) {
  const recipients = {};
  const restaurants = {};
  for (const o of customer.orders) {
    if (o.recipientName) recipients[o.recipientName] = (recipients[o.recipientName] || 0) + 1;
    if (o.restaurantName) restaurants[o.restaurantName] = (restaurants[o.restaurantName] || 0) + 1;
  }
  return { topRecipient: topItem(recipients), topRestaurant: topItem(restaurants), recipientsCount: Object.keys(recipients).length, restaurantsCount: Object.keys(restaurants).length };
}

function attribStr(attrib) {
  if (!attrib) return '—';
  const src = attrib.utmSource && attrib.utmSource !== 'none' ? attrib.utmSource : attrib.referringDomain || '—';
  const loc = [attrib.city, attrib.country].filter(Boolean).join(', ');
  return loc ? `${src} · ${loc}` : src;
}

// ==== Section 5: Returning-steady deep dive ====
function section5ReturningSteady(customers, attribution) {
  const p1Start = PERIOD1_START.getTime();
  const lapseCutoff = p1Start - LAPSE_THRESHOLD_DAYS * DAY_MS;

  const steady = [];
  for (const c of customers) {
    const p1Orders = c.orders.filter((o) => o.createdAtMs >= p1Start && o.createdAtMs < PERIOD1_END.getTime());
    const p2Orders = c.orders.filter((o) => o.createdAtMs < p1Start);
    if (p1Orders.length === 0 || p2Orders.length === 0) continue;
    const lastP2Ms = Math.max(...p2Orders.map((o) => o.createdAtMs));
    if (lastP2Ms < lapseCutoff) continue; // resurrected, not steady

    const p1Spend = p1Orders.reduce((s, o) => s + o.totalAmount, 0);
    const p2Spend = p2Orders.reduce((s, o) => s + o.totalAmount, 0);
    const lifetimeMonths = Math.max((c.lastMs - c.firstMs) / MONTH_MS, 1);
    const ordersPerMonth = c.count / lifetimeMonths;
    const agg = aggRecipientsRestaurants(c);
    steady.push({ ...c, p1Spend, p1Orders: p1Orders.length, p2Spend, p2Orders: p2Orders.length, lifetimeMonths, ordersPerMonth, ...agg });
  }
  steady.sort((a, b) => b.lifetime - a.lifetime);

  console.log();
  console.log('============================================================');
  console.log(' SECTION 5 — Returning-steady customers (the moat)');
  console.log('============================================================');
  console.log();
  console.log(`${steady.length} customers had P2 orders ending within ${LAPSE_THRESHOLD_DAYS}d of P1 start AND placed P1 orders. These are continuing customers, the closest thing you have to a retained core.`);
  console.log();
  console.log(`Common patterns to look for: shared cities, shared restaurants, shared recipient names, similar order cadence.`);
  console.log();
  console.log(`  #  Name                         Email                                Lifetime   Orders/mo   Tenure  Top recipient                  Top restaurant                Attribution`);
  steady.forEach((c, i) => {
    const attrib = attribution.get(c.email);
    console.log(`  ${(i + 1).toString().padStart(2)}. ${c.name.padEnd(28).slice(0, 28)} ${c.email.padEnd(36).slice(0, 36)} ${formatUSD(c.lifetime).padStart(8)}  ${c.ordersPerMonth.toFixed(2).padStart(5)}/mo   ${c.lifetimeMonths.toFixed(1).padStart(4)}mo  ${(c.topRecipient || '—').padEnd(30).slice(0, 30)} ${(c.topRestaurant || '—').padEnd(28).slice(0, 28)}  ${attribStr(attrib)}`);
  });

  // Cross-customer summaries
  const restaurantCounts = {};
  const recipientCityHints = {};
  const cities = {};
  for (const c of steady) {
    for (const o of c.orders) {
      if (o.restaurantName) restaurantCounts[o.restaurantName] = (restaurantCounts[o.restaurantName] || 0) + 1;
    }
    const a = attribution.get(c.email);
    if (a?.city) cities[`${a.city}, ${a.country}`] = (cities[`${a.city}, ${a.country}`] || 0) + 1;
  }
  console.log();
  console.log('Top restaurants across the steady-returning cohort (orders, all-time):');
  Object.entries(restaurantCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([r, n]) => {
    console.log(`  ${n.toString().padStart(3)}× ${r}`);
  });
  console.log();
  console.log('Sender cities (where attribution available):');
  Object.entries(cities).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([c, n]) => {
    console.log(`  ${n.toString().padStart(3)}× ${c}`);
  });
}

// ==== Section 6: Resurrectable lost ====
function section6ResurrectableLost(customers, attribution) {
  const p1Start = PERIOD1_START.getTime();
  const p1End = PERIOD1_END.getTime();
  const now = Date.now();
  const sixMonthsAgoMs = now - 6 * MONTH_MS;
  const twelveMonthsAgoMs = now - 12 * MONTH_MS;

  const lost = [];
  for (const c of customers) {
    const p1Orders = c.orders.filter((o) => o.createdAtMs >= p1Start && o.createdAtMs < p1End);
    const p2Orders = c.orders.filter((o) => o.createdAtMs < p1Start);
    if (p1Orders.length > 0) continue;     // not lost
    if (p2Orders.length === 0) continue;   // weird

    // Last activity must be 6-12 months ago — recent enough they may remember the brand
    if (c.lastMs < twelveMonthsAgoMs || c.lastMs > sixMonthsAgoMs) continue;
    if (c.winbackSentMs) continue;         // already tried

    const agg = aggRecipientsRestaurants(c);
    const daysSinceLast = Math.floor((now - c.lastMs) / DAY_MS);
    lost.push({ ...c, daysSinceLast, ...agg });
  }
  lost.sort((a, b) => b.lifetime - a.lifetime);

  console.log();
  console.log('============================================================');
  console.log(' SECTION 6 — Resurrectable lost (lapsed 6-12mo, no win-back yet)');
  console.log('============================================================');
  console.log();
  console.log(`${lost.length} customers fit: zero P1 orders, last order 6-12 months ago, never received a win-back email. These are the most plausible recovery candidates — recently enough lapsed to remember you, not so freshly lapsed that they're ignoring all emails.`);
  console.log();
  console.log(`Top ${Math.min(30, lost.length)} by lifetime spend:`);
  console.log();
  console.log(`  #  Name                         Email                                Lifetime   Orders   Last order  Top recipient                  Top restaurant                Attribution`);
  lost.slice(0, 30).forEach((c, i) => {
    const attrib = attribution.get(c.email);
    const lastDate = new Date(c.lastMs).toISOString().slice(0, 10);
    console.log(`  ${(i + 1).toString().padStart(2)}. ${c.name.padEnd(28).slice(0, 28)} ${c.email.padEnd(36).slice(0, 36)} ${formatUSD(c.lifetime).padStart(8)}  ${String(c.count).padStart(4)}    ${lastDate} (${c.daysSinceLast}d)  ${(c.topRecipient || '—').padEnd(30).slice(0, 30)} ${(c.topRestaurant || '—').padEnd(28).slice(0, 28)}  ${attribStr(attrib)}`);
  });
}

// ==== Main ====
async function main() {
  const attribution = loadAttribution();
  const customers = await loadCustomers();
  section1Concentration(customers);
  section2GrowthAccounting(customers);
  section3EarlyLapseWarning(customers);
  section4CohortComparison(customers);
  section5ReturningSteady(customers, attribution);
  section6ResurrectableLost(customers, attribution);
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
