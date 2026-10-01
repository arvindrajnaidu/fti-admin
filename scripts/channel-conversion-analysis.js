// Channel conversion analysis.
//
// Joins two PostHog exports — converted users + abandoned users — to surface:
//   1. Per-channel total visitors and conversion rate
//   2. Per-channel funnel drop-off (viewed cart → initiated checkout → reached
//      payment → completed) so you can see *where* in the flow each channel
//      breaks down
//   3. Channels with high traffic but below-median conversion rate (UX
//      hypothesis candidates)
//   4. Per-country and per-city slices on the same metrics
//
// Inputs (CSV paths hardcoded — re-export from PostHog and update paths):
const ABANDONED_CSV    = '/Users/athahar/Downloads/checkout-abandoned-users-export-2026-05-07-060401.csv';
const CONVERSION_CSV   = '/Users/athahar/Downloads/source-of-conversion-export-2026-05-07-060338.csv';
//
// Run:  node scripts/channel-conversion-analysis.js

const fs = require('fs');

const TEST_ACCOUNTS = new Set([
  'ath.sub.007@gmail.com',
  'trackwork.contact@gmail.com',
  'athahar+f1@gmail.com',
]);
const FRAUD_ACCOUNTS = new Set([
  'georgehopkins19787@gmail.com',
  'ravi1337kaji@gmail.com',
  'srikant.nayak1337@gmail.com',
  'codtechitsolutions1@gmail.com',
]);
const SKIP = new Set([...TEST_ACCOUNTS, ...FRAUD_ACCOUNTS]);

// India IP traffic is mostly noise for funnel analysis — fraudsters using
// stolen cards (Stripe rejects → shows up as "checkout errors") plus
// recipients of orders viewing the site out of curiosity. Neither group is
// a real conversion target. Keep them in the country-by-country output for
// fraud-monitoring visibility, but produce a separate "actionable funnel"
// view that excludes them.
const NOISE_COUNTRIES = new Set(['India']);

const pct = (n) => `${(n * 100).toFixed(1)}%`;

// ==== CSV parsing ====
function parseCsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((s) => s.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    // Naive split — these PostHog exports don't quote commas inside fields
    // for the columns we care about (email, names with no commas, domains).
    const cols = lines[i].split(',');
    const row = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = (cols[j] || '').trim();
    rows.push(row);
  }
  return rows;
}

function normEmail(e) {
  return (e || '').toLowerCase().trim();
}

function loadConverted() {
  return parseCsv(CONVERSION_CSV)
    .filter((r) => normEmail(r.email) && !SKIP.has(normEmail(r.email)))
    .map((r) => ({
      email: normEmail(r.email),
      name: r.name || '',
      referringDomain: r.referring_domain || 'unknown',
      utmSource: r.utm_source || '',
      utmCampaign: r.utm_campaign || '',
      city: r.city || '',
      country: r.country || '',
      firstOrderDate: r.first_order_date || '',
    }));
}

function loadAbandoned() {
  return parseCsv(ABANDONED_CSV)
    .filter((r) => normEmail(r.email) && !SKIP.has(normEmail(r.email)))
    .map((r) => ({
      email: normEmail(r.email),
      name: r.name || '',
      referringDomain: r.referring_domain || 'unknown',
      city: r.city || '',
      country: r.country || '',
      lastSeen: r.last_seen || '',
      viewedCart: r.viewed_cart === 'yes',
      initiatedCheckout: r.initiated_checkout === 'yes',
      reachedPayment: r.reached_payment === 'yes',
      checkoutError: r.checkout_error === 'yes',
      payment3dsFailed: r.payment_3ds_failed === 'yes',
      hadException: r.had_exception === 'yes',
    }));
}

// ==== Aggregation by key (channel / city / country) ====
function aggregateByKey(converted, abandoned, keyFn) {
  // For each key, build the funnel
  const acc = new Map();
  function ensure(k) {
    if (!acc.has(k)) {
      acc.set(k, {
        key: k,
        converted: 0,
        abandoned: 0,
        viewedCart: 0,        // abandoned w/ viewed_cart=yes (+ all converted)
        initiatedCheckout: 0,
        reachedPayment: 0,
        checkoutError: 0,
        payment3dsFailed: 0,
        hadException: 0,
      });
    }
    return acc.get(k);
  }

  for (const c of converted) {
    const k = keyFn(c);
    const v = ensure(k);
    v.converted += 1;
    // Converted users by definition completed every funnel step
    v.viewedCart += 1;
    v.initiatedCheckout += 1;
    v.reachedPayment += 1;
  }
  for (const a of abandoned) {
    const k = keyFn(a);
    const v = ensure(k);
    v.abandoned += 1;
    if (a.viewedCart) v.viewedCart += 1;
    if (a.initiatedCheckout) v.initiatedCheckout += 1;
    if (a.reachedPayment) v.reachedPayment += 1;
    if (a.checkoutError) v.checkoutError += 1;
    if (a.payment3dsFailed) v.payment3dsFailed += 1;
    if (a.hadException) v.hadException += 1;
  }

  for (const v of acc.values()) {
    v.total = v.converted + v.abandoned;
    v.conversionRate = v.total > 0 ? v.converted / v.total : 0;
    v.viewedCartRate = v.total > 0 ? v.viewedCart / v.total : 0;
    v.initiatedFromViewed = v.viewedCart > 0 ? v.initiatedCheckout / v.viewedCart : 0;
    v.reachedPaymentFromInitiated = v.initiatedCheckout > 0 ? v.reachedPayment / v.initiatedCheckout : 0;
    v.completedFromReached = v.reachedPayment > 0 ? v.converted / v.reachedPayment : 0;
  }

  return [...acc.values()].sort((a, b) => b.total - a.total);
}

// ==== Output ====
function printTable(title, rows, formatKeyHeader) {
  console.log();
  console.log('============================================================');
  console.log(` ${title}`);
  console.log('============================================================');
  console.log();
  console.log(`  ${formatKeyHeader.padEnd(38)} Total  Conv   Aban   Conv%   Funnel: viewed → initiated → reached → completed     Errors`);
  for (const r of rows) {
    const funnel = `${r.viewedCart}→${r.initiatedCheckout}→${r.reachedPayment}→${r.converted}`;
    const errors = (r.checkoutError + r.payment3dsFailed + r.hadException) > 0
      ? `err:${r.checkoutError} 3ds:${r.payment3dsFailed} exc:${r.hadException}`
      : '';
    const keyStr = r.key.padEnd(38).slice(0, 38);
    console.log(`  ${keyStr} ${String(r.total).padStart(5)}  ${String(r.converted).padStart(4)}   ${String(r.abandoned).padStart(4)}  ${pct(r.conversionRate).padStart(6)}   ${funnel.padEnd(28)}  ${errors}`);
  }
}

function summarizeFunnel(rows) {
  const tot = rows.reduce((acc, r) => {
    acc.total += r.total;
    acc.viewedCart += r.viewedCart;
    acc.initiatedCheckout += r.initiatedCheckout;
    acc.reachedPayment += r.reachedPayment;
    acc.converted += r.converted;
    acc.checkoutError += r.checkoutError;
    acc.payment3dsFailed += r.payment3dsFailed;
    acc.hadException += r.hadException;
    return acc;
  }, { total: 0, viewedCart: 0, initiatedCheckout: 0, reachedPayment: 0, converted: 0, checkoutError: 0, payment3dsFailed: 0, hadException: 0 });
  return tot;
}

function main() {
  console.log(`Loading converted users from ${CONVERSION_CSV}...`);
  const converted = loadConverted();
  console.log(`Loading abandoned users from ${ABANDONED_CSV}...`);
  const abandoned = loadAbandoned();
  console.log(`Loaded: ${converted.length} converted, ${abandoned.length} abandoned (after fraud/test filter).`);

  // ---- Overall funnel ----
  const overallByDummy = aggregateByKey(converted, abandoned, () => 'OVERALL');
  const overall = overallByDummy[0];
  console.log();
  console.log('============================================================');
  console.log(' OVERALL FUNNEL');
  console.log('============================================================');
  console.log();
  console.log(`Total identified visitors      : ${overall.total}`);
  console.log(`  → Viewed cart                : ${overall.viewedCart}  (${pct(overall.viewedCartRate)} of total)`);
  console.log(`    → Initiated checkout       : ${overall.initiatedCheckout}  (${pct(overall.initiatedFromViewed)} of viewed)`);
  console.log(`      → Reached payment        : ${overall.reachedPayment}  (${pct(overall.reachedPaymentFromInitiated)} of initiated)`);
  console.log(`        → Converted (placed)   : ${overall.converted}  (${pct(overall.completedFromReached)} of reached payment)`);
  console.log();
  console.log(`Final conversion rate          : ${pct(overall.conversionRate)}`);
  if (overall.checkoutError + overall.payment3dsFailed + overall.hadException > 0) {
    console.log();
    console.log(`Failures observed in the abandoned cohort:`);
    console.log(`  Checkout errors              : ${overall.checkoutError}`);
    console.log(`  3DS payment failures         : ${overall.payment3dsFailed}`);
    console.log(`  Exceptions                   : ${overall.hadException}`);
  }

  // ---- Actionable funnel (ex-India) ----
  const convertedClean = converted.filter((r) => !NOISE_COUNTRIES.has(r.country));
  const abandonedClean = abandoned.filter((r) => !NOISE_COUNTRIES.has(r.country));
  const cleanFunnel = aggregateByKey(convertedClean, abandonedClean, () => 'CLEAN')[0];
  console.log();
  console.log('============================================================');
  console.log(' ACTIONABLE FUNNEL (excludes India — fraud + recipient noise)');
  console.log('============================================================');
  console.log();
  console.log(`Total identified visitors      : ${cleanFunnel.total}  (filtered: ${converted.length + abandoned.length - cleanFunnel.total} India rows)`);
  console.log(`  → Viewed cart                : ${cleanFunnel.viewedCart}  (${pct(cleanFunnel.viewedCartRate)} of total)`);
  console.log(`    → Initiated checkout       : ${cleanFunnel.initiatedCheckout}  (${pct(cleanFunnel.initiatedFromViewed)} of viewed)`);
  console.log(`      → Reached payment        : ${cleanFunnel.reachedPayment}  (${pct(cleanFunnel.reachedPaymentFromInitiated)} of initiated)`);
  console.log(`        → Converted (placed)   : ${cleanFunnel.converted}  (${pct(cleanFunnel.completedFromReached)} of reached payment)`);
  console.log();
  console.log(`Final conversion rate          : ${pct(cleanFunnel.conversionRate)}  (vs ${pct(overall.conversionRate)} including India)`);

  // ---- Channel (referring_domain) — ex-India ----
  const byChannel = aggregateByKey(convertedClean, abandonedClean, (r) => r.referringDomain || 'unknown');
  printTable('Channel conversion (ex-India, by referring_domain)', byChannel, 'Channel');

  // ---- Country ----
  const byCountry = aggregateByKey(converted, abandoned, (r) => r.country || 'unknown');
  printTable('Country conversion', byCountry.slice(0, 20), 'Country');

  // ---- Channel × Country (top 15) ----
  const byChannelCountry = aggregateByKey(converted, abandoned, (r) => `${r.referringDomain || '?'}  /  ${r.country || '?'}`);
  printTable('Channel × Country (top 15)', byChannelCountry.slice(0, 15), 'Channel / Country');

  // ---- UX hypothesis: high-volume channels (ex-India) with below-median conv rate ----
  // Uses ex-India byChannel which is already filtered.
  const meaningfulChannels = byChannel.filter((c) => c.total >= 5);
  if (meaningfulChannels.length >= 2) {
    const sortedRates = [...meaningfulChannels].map((c) => c.conversionRate).sort((a, b) => a - b);
    const median = sortedRates[Math.floor(sortedRates.length / 2)];
    const underperformers = meaningfulChannels.filter((c) => c.conversionRate < median);
    console.log();
    console.log('============================================================');
    console.log(' UX HYPOTHESIS — channels with below-median conversion rate');
    console.log('============================================================');
    console.log();
    console.log(`Median channel conv rate (channels with ≥5 visitors): ${pct(median)}`);
    if (underperformers.length === 0) {
      console.log(`No high-volume channels under-performing — conversion is fairly uniform across channels.`);
    } else {
      console.log(`Channels worth investigating (volume ≥ 5, conv < median):`);
      console.log();
      for (const c of underperformers) {
        const dropAt = (() => {
          if (c.viewedCart === 0 && c.total > 0) return `most users never view the cart (${c.total - c.viewedCart} bounced before cart)`;
          if (c.initiatedCheckout === 0 && c.viewedCart > 0) return `viewed cart but didn't start checkout (${c.viewedCart - c.initiatedCheckout} bounced)`;
          const initToReachLoss = c.initiatedCheckout - c.reachedPayment;
          const reachToConvLoss = c.reachedPayment - c.converted;
          if (initToReachLoss >= reachToConvLoss && initToReachLoss > 0) return `between checkout-start and payment (${initToReachLoss} dropped)`;
          if (reachToConvLoss > 0) return `at payment screen (${reachToConvLoss} reached payment but didn't complete)`;
          return `mixed`;
        })();
        console.log(`  ${c.key.padEnd(36)}  ${pct(c.conversionRate).padStart(6)} conv  /  ${c.total.toString().padStart(3)} visitors  →  biggest drop: ${dropAt}`);
      }
    }
  }
}

main();
