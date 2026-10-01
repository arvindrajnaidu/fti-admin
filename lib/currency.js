/**
 * USD conversion for stored order amounts.
 *
 * Order docs store subTotal / tax / deliveryFee / totalAmount in INR **paise**.
 * Their USD value depends on the conversion rate that was in force when the
 * order was placed, so dividing by any single constant is wrong across a window
 * that spans a pricing change. Several admin pages used to divide by 10000
 * (implying Rs 100/$, a rate the app has never charged), which under-reported
 * revenue, LTV and the customers CSV.
 *
 * Accuracy order, best first:
 *   1. paymentIntent.amount  - USD cents straight from Stripe. Ground truth,
 *                              and present on 99.4% of orders (3759/3780 as of
 *                              2026-08-06).
 *   2. conversionPaisePerUsd - the rate stamped on the order doc. Written on
 *                              every order since 2026-07-28.
 *   3. RATE_HISTORY          - the rate in force on the order's date. Only ever
 *                              needed for the handful of pre-2026-07-28 orders
 *                              with no paymentIntent (21 of 3780: fully
 *                              credit-covered orders).
 *   4. LEGACY_CONVERSION     - last-resort default.
 *
 * Orders have carried their own rate since 2026-07-28. Carts do NOT yet: as of
 * 2026-08-09 all 1,364 temp-orders in prod are unstamped, and the consumer
 * change that stamps them (pages/api/save-temp-order.js on feat/pricing-v3) is
 * still uncommitted. Until it deploys, EVERY cart resolves through
 * RATE_HISTORY, so the rows below must stay accurate - do not treat this table
 * as historical-only yet. See the note inside RATE_HISTORY for why no Rs69 row
 * is needed even after that lands.
 *
 * Rate history below was derived from real charges
 * (totalAmount / paymentIntent.amount), not from code comments, on 2026-08-06.
 */

// Paise per USD, most recent first. `from` is the UTC ms of the first order
// observed at that rate.
const RATE_HISTORY = [
  // NO Rs69 ROW IS NEEDED, AND NONE SHOULD EVER BE ADDED. This table is only
  // consulted by rateForDate(), which orderConversion() reaches ONLY when a doc
  // has no conversionPaisePerUsd of its own.
  //
  // The pricing-v3 deploy ships CONVERSION=6900 AND cart stamping together
  // (pages/api/save-temp-order.js), so from that instant every new order and
  // every new cart carries its own rate and never consults this table.
  //
  // Adding a 6900 row would therefore be actively harmful: the only docs it
  // could ever match are UNSTAMPED ones written BEFORE that deploy, which were
  // priced at Rs71. Verified on prod 2026-08-09 - 368 unstamped carts sit
  // inside admin's 30-day window and every one of them was priced at Rs71.
  //
  // Adding a 6900 row could only ever mis-value a historical doc. This table
  // describes the past; it is finished. If a future rate change is ever made
  // WITHOUT stamping, that is the bug to fix, not this table.
  // Boundary is the DEPLOY INSTANT, not UTC midnight. The earliest order
  // actually stamped 7100 is 2026-07-28T10:50:58.873Z. Using midnight put 3
  // orders and 5 temp-orders from that morning on the wrong side: their real
  // charge implies Rs75 (totalAmount / paymentIntent.amount), and one is still
  // pending, so a reminder would have over-quoted it by 5.6%.
  { from: Date.parse('2026-07-28T10:50:58.873Z'), paisePerUsd: 7100 }, // Rs 71
  { from: Date.UTC(2026, 4, 18), paisePerUsd: 7500 }, // Rs 75, 2026-05-18 ->
  { from: Date.UTC(2025, 11, 10), paisePerUsd: 8200 }, // Rs 82, 2025-12-10 ->
  { from: Date.UTC(2024, 9, 30), paisePerUsd: 9500 }, // Rs 95, 2024-10-30 ->
  { from: Date.UTC(2022, 9, 16), paisePerUsd: 8300 }, // Rs 83, 2022-10-16 ->
  { from: Date.UTC(2022, 2, 23), paisePerUsd: 7700 }, // Rs 77, 2022-03-23 ->
  { from: 0, paisePerUsd: 7500 }, // Rs ~74-75, earliest orders (2021 ->)
];

const LEGACY_CONVERSION = 7500;
// Backstop for a doc with no usable paise to cross-check a Stripe amount
// against. Generous: 45x the largest real order we have ever taken.
const MAX_PLAUSIBLE_ORDER_USD = 5000;

const toMs = (v) => {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (v instanceof Date) return v.getTime();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  const parsed = Date.parse(v);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Rate in force on a given timestamp. */
const rateForDate = (ms) => {
  if (!Number.isFinite(ms)) return LEGACY_CONVERSION;
  const hit = RATE_HISTORY.find((r) => ms >= r.from);
  return hit ? hit.paisePerUsd : LEGACY_CONVERSION;
};

/**
 * Rate DERIVED from the order's own Stripe charge.
 *
 * totalAmount (paise) / actual USD charged IS the rate the customer was billed
 * at - it is measured, not looked up, so it is right even for an order written
 * before rate-stamping existed and regardless of when any deploy happened.
 *
 * It also makes the component rows self-consistent: converting subTotal, tax
 * and deliveryFee at this rate makes them sum to exactly what Stripe took.
 *
 * Guarded: only trust a result in a sane band. A refunded, partially-captured
 * or store-credit order can make this meaningless.
 */
const derivedConversion = (order) => {
  const paise = Number(order?.totalAmount);
  const cents = Number(order?.paymentIntent?.amount);
  if (!Number.isFinite(paise) || !Number.isFinite(cents) || paise <= 0 || cents <= 0) return null;
  const rate = paise / (cents / 100);
  // Every rate we have ever charged sits between Rs60 and Rs110 per USD.
  return rate >= 6000 && rate <= 11000 ? rate : null;
};

/**
 * Paise-per-USD rate for a stored order, best source first:
 *   1. the rate STAMPED on the doc          - exact, since 2026-07-28
 *   2. the rate DERIVED from its Stripe charge - measured ground truth
 *   3. the rate in force on its date        - a guess, and the only one that
 *      can disagree with what the customer actually paid
 *
 * Step 2 is why RATE_HISTORY barely matters for orders: the doc carries enough
 * to reconstruct its own rate. Reporting and order detail therefore show what
 * was really charged, not what a table thinks was charged that day. Carts have
 * no Stripe charge, so for an UNSTAMPED cart step 3 is all there is.
 */
const orderConversion = (order) => {
  if (order?.conversionPaisePerUsd) return order.conversionPaisePerUsd;
  const derived = derivedConversion(order);
  if (derived) return derived;
  return rateForDate(toMs(order?.createdAt));
};

/**
 * USD value of an order. Prefers what Stripe actually charged; falls back to
 * converting the stored paise at the order's own rate.
 *
 * Returns a Number of dollars (not cents), so callers can sum across orders
 * that span different rates - which is the whole point.
 */
const orderUsd = (order) => {
  const cents = Number(order?.paymentIntent?.amount);
  const paise = Number(order?.totalAmount || 0);

  if (Number.isFinite(cents) && cents > 0) {
    const usd = cents / 100;
    // Stripe is ground truth, but only when the doc does not contradict itself.
    // 15 launch-week docs (2021-07, uid 47iGpbjS2...) carry a falsy totalAmount
    // and a garbage paymentIntent.amount up to 11,642,670 cents = $116,426.70.
    // Trusting those unconditionally inflated one customer's Total Spent to
    // $432,373. derivedConversion below already bounds its result; this did not,
    // in the same file.
    const plausible = paise > 0
      // Cross-check: the implied rate must be a rate we could have charged.
      ? (paise / usd) >= 6000 && (paise / usd) <= 11000
      // No paise to check against, so fall back to an absolute ceiling. The
      // largest genuine order observed is ~$110.
      : usd <= MAX_PLAUSIBLE_ORDER_USD;
    if (plausible) return usd;
  }

  if (!paise) return 0;
  return paise / orderConversion(order);
};

/**
 * USD value of a component amount on an order (tax, deliveryFee, subTotal, or a
 * saved cart total). These have no separate Stripe figure, so they always
 * convert at the order's own rate.
 */
const paiseToUsd = (paise, order) => {
  const n = Number(paise || 0);
  if (!n) return 0;
  return n / orderConversion(order);
};

/** `$12.34`. Takes dollars, not paise. */
const formatUsd = (usd) => {
  const n = Number(usd || 0);
  return `$${n.toFixed(2)}`;
};

module.exports = {
  RATE_HISTORY,
  LEGACY_CONVERSION,
  rateForDate,
  orderConversion,
  orderUsd,
  paiseToUsd,
  formatUsd,
};
