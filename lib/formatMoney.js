// Currency-aware money formatter.
//
// Grocery orders store `chargedAmountCents` as USD cents (Stripe ground
// truth — currency: "usd" at website/lib/grocery-order.js:132). Food orders
// store amounts in INR paise and convert to USD using the Stripe-derived
// rate inline on /orders. This helper handles the simple cases — USD and
// INR — without taking on the food page's per-order conversion logic.
//
// Usage:
//   formatMoney({ cents: order.chargedAmountCents, currency: 'usd' }) // "$15.42"
//   formatMoney({ cents: 128400, currency: 'inr' })                   // "₹1,284"

const FORMATTERS = {
  usd: new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
  inr: new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }),
};

export function formatMoney({ cents, currency }) {
  const key = (currency || 'usd').toLowerCase();
  const formatter = FORMATTERS[key];
  const amount = (cents || 0) / 100;
  if (!formatter) return `${amount.toFixed(2)} ${key.toUpperCase()}`;
  return formatter.format(amount);
}
