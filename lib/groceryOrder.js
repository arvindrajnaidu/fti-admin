// Shared display helpers for grocery orders. Centralized so the list,
// dispatch, and detail pages all render source/store/IDs the same way.

const SOURCE_LABELS = {
  instamart: 'Instamart',
  blinkit: 'Blinkit',
};

export function sourceLabel(source) {
  if (!source) return 'Unknown';
  return SOURCE_LABELS[source.toLowerCase()] || source;
}

// Doc IDs for grocery orders are Stripe PaymentIntent IDs (pi_*).
// Show "pi_3Q…F9C12" in compact contexts; the full ID is what pastes into
// Stripe Dashboard / Slack threads, so always offer a copy affordance.
export function abbreviatePaymentIntentId(id) {
  if (!id || id.length <= 12) return id || '';
  return `${id.slice(0, 5)}…${id.slice(-5)}`;
}

// Build a Stripe Dashboard URL for a PaymentIntent. The /test/ segment is
// omitted intentionally — the dashboard auto-routes to the right
// (test vs live) view based on the user's session and the ID prefix.
export function stripeDashboardUrl(paymentIntentId) {
  if (!paymentIntentId) return null;
  return `https://dashboard.stripe.com/payments/${paymentIntentId}`;
}

// `store` is shaped { id, name?, area?/locality?/city? }. Live Blinkit
// data uses `locality`; Instamart may use `area` or `city`. All three are
// checked. Degrades to ID-only if nothing else is present.
export function formatStore(store) {
  if (!store) return null;
  const parts = [];
  const idPart = store.id ? `store ${store.id}` : null;
  const areaPart = store.area || store.locality || store.city || null;
  if (idPart) parts.push(idPart);
  if (areaPart) parts.push(areaPart);
  return parts.length ? parts.join(' · ') : null;
}

// lineItems may be an array OR an object keyed by product id (Blinkit
// shape). Normalize to an array so call sites don't have to care.
export function lineItemsArray(lineItems) {
  if (!lineItems) return [];
  if (Array.isArray(lineItems)) return lineItems;
  if (typeof lineItems === 'object') return Object.values(lineItems);
  return [];
}

// Total items count for an order's lineItems.
export function itemCount(lineItems) {
  return lineItemsArray(lineItems).reduce(
    (sum, item) => sum + (item.quantity || item.qty || 1),
    0,
  );
}

// First-three item names for a subtitle preview ("atta · dal · curd · …").
export function itemPreview(lineItems, max = 3) {
  const items = lineItemsArray(lineItems);
  if (items.length === 0) return '';
  const names = items
    .slice(0, max)
    .map((i) => i.name || i.title || '')
    .filter(Boolean);
  if (items.length > max) names.push('…');
  return names.join(' · ');
}
