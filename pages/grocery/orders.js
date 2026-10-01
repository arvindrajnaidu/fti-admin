import { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import NextLink from 'next/link';
import { Loader } from '@cloudflare/kumo';
import { Receipt, ArrowsClockwise } from '@phosphor-icons/react';
import { withAuth } from '../../lib/withAuth';
import { AdminShell } from '../../components/layout/AdminShell';
import { PageHeader } from '../../components/layout/PageHeader';
import { TableShell, Th, Tr, Td, Pill, Dash } from '../../components/data/DataTable';
import { formatMoney } from '../../lib/formatMoney';
import {
  sourceLabel,
  abbreviatePaymentIntentId,
  formatStore,
  itemCount,
  itemPreview,
} from '../../lib/groceryOrder';

const STATUS_FILTERS = ['All', 'Created', 'Cancelled'];

const formatPlaced = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

function statusPill(status) {
  const normalized = (status || 'created').toLowerCase();
  if (normalized === 'cancelled') return <Pill tone="danger">Cancelled</Pill>;
  if (normalized === 'confirmed') return <Pill tone="warn">Confirmed</Pill>;
  if (normalized === 'delivered') return <Pill tone="success">Delivered</Pill>;
  if (normalized === 'out_for_delivery' || normalized === 'out-for-delivery') {
    return <Pill tone="success">Out for delivery</Pill>;
  }
  return <Pill tone="neutral">Created</Pill>;
}

function sourcePill(source) {
  const tone = source === 'instamart' ? 'success' : source === 'blinkit' ? 'warn' : 'neutral';
  return <Pill tone={tone}>{sourceLabel(source)}</Pill>;
}

export default function GroceryOrdersPage() {
  const [environment, setEnvironment] = useState('dev');
  const [statusFilter, setStatusFilter] = useState('All');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/environment')
      .then((r) => r.json())
      .then((d) => d && setEnvironment(d.environment))
      .catch(() => {});
  }, []);

  const fetchOrders = useCallback(async (force = false) => {
    setError(null);
    try {
      const url = `/api/grocery-orders?limit=200${force ? '&forceRefresh=true' : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) {
        setError(data.message || data.error);
        setOrders([]);
      } else {
        setOrders(data.orders || []);
      }
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchOrders().finally(() => setLoading(false));
  }, [fetchOrders]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchOrders(true);
    } finally {
      setRefreshing(false);
    }
  };

  const filteredOrders = useMemo(() => {
    if (statusFilter === 'All') return orders;
    const target = statusFilter.toLowerCase();
    return orders.filter((o) => (o.status || 'created').toLowerCase() === target);
  }, [orders, statusFilter]);

  return (
    <>
      <Head>
        <title>Grocery Orders · FoodtoIndia Admin</title>
      </Head>
      <AdminShell environment={environment}>
        <PageHeader
          title="Grocery Orders"
          subtitle="All grocery orders, newest first. Source shown for ops debugging — customer never sees it."
          icon={Receipt}
          filters={{
            active: statusFilter,
            options: STATUS_FILTERS,
            onChange: setStatusFilter,
          }}
          actions={
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing || loading}
              className="inline-flex items-center gap-1.5 rounded-[6px] border border-ink-100 bg-ink-0 px-3 py-1.5 text-[12.5px] font-medium text-ink-700 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowsClockwise className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          }
        />

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader />
          </div>
        ) : error ? (
          <div className="rounded-[6px] border border-danger/20 bg-danger-weak px-4 py-3 text-[13px] text-danger">
            {error}
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="rounded-[6px] border border-ink-100 bg-ink-50 px-4 py-10 text-center text-[13px] text-ink-500">
            No grocery orders match this filter.
          </div>
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Placed</Th>
                <Th>Sender</Th>
                <Th>Source</Th>
                <Th>Recipient · Store</Th>
                <Th>Items</Th>
                <Th align="right">Total</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => {
                const recipientName = order.recipient?.name || <Dash />;
                const storeLine = formatStore(order.store);
                const itemsTotal = itemCount(order.lineItems);
                const itemsLine = itemPreview(order.lineItems);
                const totalCents =
                  order.chargedAmountCents ?? order.paymentIntent?.amount ?? 0;
                return (
                  <Tr
                    key={order.id}
                    onClick={() => {
                      window.location.href = `/grocery/orders/${encodeURIComponent(order.id)}?userId=${encodeURIComponent(order.userId || '')}`;
                    }}
                    className="cursor-pointer"
                  >
                    <Td>
                      <NextLink
                        href={`/grocery/orders/${encodeURIComponent(order.id)}?userId=${encodeURIComponent(order.userId || '')}`}
                        className="font-mono text-[12px] text-ink-700 hover:text-ink-900"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {abbreviatePaymentIntentId(order.id)}
                      </NextLink>
                    </Td>
                    <Td className="text-ink-700">{formatPlaced(order.createdAt)}</Td>
                    <Td>
                      <div className="leading-tight">
                        <div>{order.senderName || <Dash />}</div>
                        {order.senderEmail ? (
                          <div className="text-[11px] text-ink-400">{order.senderEmail}</div>
                        ) : null}
                      </div>
                    </Td>
                    <Td>{sourcePill(order.source)}</Td>
                    <Td>
                      <div className="leading-tight">
                        <div>{recipientName}</div>
                        {storeLine ? (
                          <div className="text-[11px] text-ink-400">{storeLine}</div>
                        ) : null}
                      </div>
                    </Td>
                    <Td>
                      <div className="leading-tight">
                        <div>{itemsTotal > 0 ? `${itemsTotal} items` : <Dash />}</div>
                        {itemsLine ? (
                          <div className="text-[11px] text-ink-400">{itemsLine}</div>
                        ) : null}
                      </div>
                    </Td>
                    <Td align="right" className="font-num tnum">
                      {formatMoney({ cents: totalCents, currency: 'usd' })}
                    </Td>
                    <Td>{statusPill(order.status)}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </TableShell>
        )}
      </AdminShell>
    </>
  );
}

export const getServerSideProps = withAuth();
