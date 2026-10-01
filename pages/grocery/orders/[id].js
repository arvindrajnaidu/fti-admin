import { useState } from 'react';
import Head from 'next/head';
import NextLink from 'next/link';
import { ArrowSquareOut, ArrowLeft, Copy, Check } from '@phosphor-icons/react';
import { withAuth } from '../../../lib/withAuth';
import { db } from '../../../lib/firebase';
import { AdminShell } from '../../../components/layout/AdminShell';
import { PageHeader } from '../../../components/layout/PageHeader';
import { TableShell, Th, Tr, Td, Pill, Dash } from '../../../components/data/DataTable';
import { InternalNotes } from '../../../components/orders/InternalNotes';
import { formatMoney } from '../../../lib/formatMoney';
import {
  sourceLabel,
  stripeDashboardUrl,
  formatStore,
  lineItemsArray,
} from '../../../lib/groceryOrder';

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function StatusPill({ status }) {
  const s = (status || 'created').toLowerCase();
  if (s === 'cancelled') return <Pill tone="danger">Cancelled</Pill>;
  if (s === 'delivered') return <Pill tone="success">Delivered</Pill>;
  if (s === 'confirmed') return <Pill tone="warn">Confirmed</Pill>;
  return <Pill tone="neutral">Created</Pill>;
}

function SourcePill({ source }) {
  const tone = source === 'instamart' ? 'success' : source === 'blinkit' ? 'warn' : 'neutral';
  return <Pill tone={tone}>{sourceLabel(source)}</Pill>;
}

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {}
      }}
      className="inline-flex h-6 w-6 items-center justify-center rounded-[5px] border border-ink-100 text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-900"
      title="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5" weight="bold" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function Section({ title, children, className = '' }) {
  return (
    <section className={`rounded-[8px] border border-ink-100 bg-ink-0 p-4 ${className}`}>
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-micro text-ink-500">
        {title}
      </h3>
      {children}
    </section>
  );
}

function KV({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-[11px] font-medium uppercase tracking-micro text-ink-400">{label}</div>
      <div className="text-[13.5px] text-ink-900">{value || <Dash />}</div>
    </div>
  );
}

export default function GroceryOrderDetailPage({ order, environment, error }) {
  if (error) {
    return (
      <AdminShell environment={environment}>
        <PageHeader title="Grocery order not found" />
        <div className="rounded-[6px] border border-danger/20 bg-danger-weak px-4 py-3 text-[13px] text-danger">
          {error}
        </div>
        <NextLink
          href="/grocery/orders"
          className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-ink-500 hover:text-ink-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to grocery orders
        </NextLink>
      </AdminShell>
    );
  }

  const totalCents = order.chargedAmountCents ?? order.paymentIntent?.amount ?? 0;
  const subtotalCents = order.totals?.subTotalCents ?? 0;
  const deliveryCents = order.totals?.deliveryFeeCents ?? 0;
  const taxCents = order.totals?.taxCents ?? 0;
  const fmt = (cents) => formatMoney({ cents, currency: 'usd' });

  const stripeUrl = stripeDashboardUrl(order.id);
  const storeLine = formatStore(order.store);

  return (
    <>
      <Head>
        <title>Grocery order · {order.id} · FoodtoIndia Admin</title>
      </Head>
      <AdminShell environment={environment}>
        <NextLink
          href="/grocery/orders"
          className="mb-3 inline-flex items-center gap-1.5 text-[12px] text-ink-500 hover:text-ink-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All grocery orders
        </NextLink>

        <PageHeader
          title="Grocery order"
          subtitle={`Placed ${fmtDateTime(order.createdAt)}`}
        />

        {/* Header card */}
        <div className="mb-5 rounded-[8px] border border-ink-100 bg-ink-0 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <code className="break-all rounded-[5px] bg-ink-50 px-2 py-1 font-mono text-[12.5px] text-ink-700">
                  {order.id}
                </code>
                <CopyButton value={order.id} />
                {stripeUrl ? (
                  <a
                    href={stripeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-[5px] border border-ink-100 px-2 py-1 text-[11.5px] text-ink-600 transition-colors hover:bg-ink-50 hover:text-ink-900"
                    title="Open in Stripe Dashboard"
                  >
                    Stripe <ArrowSquareOut className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <SourcePill source={order.source} />
                <StatusPill status={order.status} />
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] font-medium uppercase tracking-micro text-ink-400">
                Charged
              </div>
              <div className="font-num text-[22px] font-semibold tabular-nums text-ink-900">
                {fmt(totalCents)}
              </div>
            </div>
          </div>
        </div>

        {/* Sender / Recipient / Store grid */}
        <div className="mb-5 grid gap-4 md:grid-cols-3">
          <Section title="Sender">
            <div className="space-y-2">
              <KV label="Name" value={order.senderName || order.sender?.displayName} />
              <KV label="Email" value={order.senderEmail || order.sender?.email} />
            </div>
          </Section>
          <Section title="Recipient">
            <div className="space-y-2">
              <KV label="Name" value={order.recipient?.name} />
              <KV
                label="Phone"
                value={order.recipient?.phone || order.recipient?.recipientPhone}
              />
              <KV
                label="Address"
                value={
                  order.recipient?.address ||
                  order.recipient?.formattedAddress ||
                  order.recipient?.street
                }
              />
            </div>
          </Section>
          <Section title="Store">
            <div className="space-y-2">
              <KV label="Provider" value={sourceLabel(order.source)} />
              <KV label="Store ID" value={order.store?.id} />
              <KV label="Name" value={order.store?.name} />
              <KV
                label="Area"
                value={order.store?.area || order.store?.locality || order.store?.city || null}
              />
            </div>
            {!order.store?.area && !order.store?.locality && !order.store?.name ? (
              <div className="mt-3 rounded-[5px] bg-warn-weak px-2 py-1.5 text-[11px] text-warn">
                Store name + area aren't yet stamped on the order doc by the consumer
                side. Showing what's available.
              </div>
            ) : null}
          </Section>
        </div>

        {/* Line items */}
        <Section title="Line items" className="mb-5">
          {(() => {
            const items = lineItemsArray(order.lineItems);
            if (items.length === 0) {
              return <div className="text-[13px] italic text-ink-500">No line items recorded.</div>;
            }
            return (
              <TableShell>
                <thead>
                  <tr>
                    <Th>Item</Th>
                    <Th align="right">Qty</Th>
                    <Th align="right">Unit</Th>
                    <Th align="right">Line total</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => {
                    const qty = item.quantity || item.qty || 1;
                    const unitCents = item.unitPriceCents ?? item.priceCents ?? 0;
                    const lineCents =
                      item.itemTotalCents ?? item.lineTotalCents ?? unitCents * qty;
                    const key = item.itemKey || item.id || item.providerProductId || `${item.name}-${i}`;
                    return (
                      <Tr key={key}>
                        <Td>
                          <div className="flex items-start gap-2 leading-tight">
                            {item.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={item.imageUrl}
                                alt=""
                                className="h-8 w-8 shrink-0 rounded-[4px] object-cover"
                              />
                            ) : null}
                            <div>
                              <div>{item.name || item.title || 'Item'}</div>
                              {item.quantityLabel || item.variant ? (
                                <div className="text-[11px] text-ink-400">
                                  {item.quantityLabel || item.variant}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </Td>
                        <Td align="right" className="font-num tnum">{qty}</Td>
                        <Td align="right" className="font-num tnum">{fmt(unitCents)}</Td>
                        <Td align="right" className="font-num tnum">{fmt(lineCents)}</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </TableShell>
            );
          })()}

          {/* Totals breakdown */}
          {order.totals ? (
            <div className="mt-4 max-w-sm space-y-1.5 text-[13px] text-ink-700">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="font-num tnum">{fmt(subtotalCents)}</span>
              </div>
              <div className="flex justify-between">
                <span>Delivery</span>
                <span className="font-num tnum">{fmt(deliveryCents)}</span>
              </div>
              <div className="flex justify-between">
                <span>Tax</span>
                <span className="font-num tnum">{fmt(taxCents)}</span>
              </div>
              <div className="flex justify-between border-t border-ink-100 pt-1.5 font-semibold text-ink-900">
                <span>Total</span>
                <span className="font-num tnum">{fmt(totalCents)}</span>
              </div>
            </div>
          ) : null}
        </Section>

        {order.notes ? (
          <Section title="Sender notes" className="mb-5">
            <div className="whitespace-pre-wrap text-[13.5px] text-ink-700">{order.notes}</div>
          </Section>
        ) : null}

        {/* Internal notes — reuses the food component, just points at the
            grocery_orders subcollection via the new `collection` prop. */}
        <InternalNotes
          userId={order.userId}
          orderId={order.id}
          collection="grocery_orders"
        />
      </AdminShell>
    </>
  );
}

// Walk the order doc and convert Firestore Timestamps to ISO strings so
// they pass through Next's JSON serialization for getServerSideProps.
function serializeForProps(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(serializeForProps);
  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') return value.toDate().toISOString();
    if (value.constructor && value.constructor.name === 'Timestamp') {
      return value.toDate ? value.toDate().toISOString() : null;
    }
    const out = {};
    for (const k of Object.keys(value)) out[k] = serializeForProps(value[k]);
    return out;
  }
  return value;
}

export const getServerSideProps = withAuth(async (context) => {
  const { id, userId } = context.query;
  if (!id || !userId) {
    return { props: { error: 'Missing order id or userId in the URL.' } };
  }
  if (!db) {
    return { props: { error: 'Firebase is not initialized on this admin instance.' } };
  }
  try {
    const ref = db
      .collection('users')
      .doc(String(userId))
      .collection('grocery_orders')
      .doc(String(id));
    const snap = await ref.get();
    if (!snap.exists) {
      return { props: { error: `No grocery order ${id} for user ${userId}.` } };
    }
    const order = serializeForProps({ id: snap.id, userId: String(userId), ...snap.data() });
    const environment =
      process.env.FIREBASE_ENV === 'production' || process.env.VERCEL_ENV === 'production'
        ? 'production'
        : 'development';
    return { props: { order, environment } };
  } catch (err) {
    console.error('grocery order detail load failed:', err);
    return { props: { error: 'Failed to load grocery order.' } };
  }
});
