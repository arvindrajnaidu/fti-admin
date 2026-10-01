// Synthesizes an order's audit-trail events from timestamp fields the
// order document already stores. No event docs are written at status-change
// time — the trail is derived at read time, so it works for every existing
// order and can never drift from the order's real state.
//
// Returns newest-first [{ kind, text, ts }]. `kind` drives the icon in the
// InternalNotes feed: placed / address / time / dispatch / cancel / credit.

// Coerce a Firestore Timestamp, epoch number, ISO string, or Date to epoch ms.
export function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  if (v instanceof Date) return v.getTime();
  return null;
}

export function buildOrderActivity(order) {
  if (!order) return [];
  const rc = order.recipientContact || {};
  const events = [];
  const push = (kind, text, raw, extra) => {
    const ts = toMs(raw);
    if (ts) events.push({ kind, text, ts, ...extra });
  };

  push('placed', 'Order placed', order.createdAt);

  // One address event — a recorded confirmation outranks a plain ops edit.
  if (rc.confirmedAt) {
    const byOps = typeof rc.confirmedBy === 'string' && rc.confirmedBy.startsWith('ops:');
    push('address', byOps ? 'Address confirmed by ops' : 'Address confirmed by recipient', rc.confirmedAt);
  } else if (rc.opsAddressSetAt) {
    push('address', 'Address updated by ops', rc.opsAddressSetAt);
  }

  push('time', 'Delivery time updated by ops', rc.opsTimeSetAt);

  // Dispatch — show for any dispatched order. dispatchedAt is the precise
  // time when present; orders dispatched before that field existed fall
  // back to updatedAt. The tracking link rides along on the event.
  if (order.dispatchedAt || order.status === 'dispatched') {
    push(
      'dispatch',
      'Order dispatched',
      order.dispatchedAt || order.updatedAt,
      order.tracking_link ? { url: order.tracking_link } : undefined,
    );
  }

  push('cancel', 'Order cancelled', order.cancelledAt);
  push('credit', 'Store credit issued', order.storeCreditIssuedAt);

  events.sort((a, b) => b.ts - a.ts);
  return events;
}
