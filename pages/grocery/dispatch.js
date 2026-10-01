import { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import NextLink from 'next/link';
import { Loader } from '@cloudflare/kumo';
import { Truck, ArrowsClockwise } from '@phosphor-icons/react';
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
} from '../../lib/groceryOrder';

const FILTERS = ['Open', 'Last 24h', 'All'];

// Show "14m ago" / "1h 22m ago" / "3h ago" — useful in a queue view where
// the relative recency is what tells the dispatcher whether to act now.
// Takes nowMs so a parent ticker can drive re-renders without a refetch.
function timeAgo(iso, nowMs = Date.now()) {
  if (!iso) return '—';
  const diff = nowMs - new Date(iso).getTime();
  if (diff < 0) return 'just now';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  if (hr < 24) return remMin > 0 ? `${hr}h ${remMin}m ago` : `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function sourcePill(source) {
  const tone = source === 'instamart' ? 'success' : source === 'blinkit' ? 'warn' : 'neutral';
  return <Pill tone={tone}>{sourceLabel(source)}</Pill>;
}

export default function GroceryDispatchPage() {
  const [environment, setEnvironment] = useState('dev');
  const [activeFilter, setActiveFilter] = useState('Open');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

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

  // Tick every minute so the relative "Xm ago" labels stay current without
  // re-fetching orders. Matches the food dispatch ticker pattern.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchOrders(true);
      setNowMs(Date.now());
    } finally {
      setRefreshing(false);
    }
  };

  const visibleOrders = useMemo(() => {
    if (activeFilter === 'All') return orders;
    if (activeFilter === 'Last 24h') {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      return orders.filter((o) => o.createdAt && new Date(o.createdAt).getTime() >= cutoff);
    }
    // Open — anything in 'created' (the only actionable state today).
    return orders.filter((o) => (o.status || 'created').toLowerCase() === 'created');
  }, [orders, activeFilter]);

  const openCount = useMemo(
    () => orders.filter((o) => (o.status || 'created').toLowerCase() === 'created').length,
    [orders],
  );

  return (
    <>
      <Head>
        <title>Grocery Dispatch · FoodtoIndia Admin</title>
      </Head>
      <AdminShell environment={environment}>
        <PageHeader
          title="Grocery Dispatch"
          subtitle={
            loading
              ? 'Loading grocery queue…'
              : `${openCount} open. Grocery orders paid and awaiting fulfilment. Provider acceptance and rider state will appear here once those backend fields land.`
          }
          icon={Truck}
          filters={{
            active: activeFilter,
            options: FILTERS,
            onChange: setActiveFilter,
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
        ) : visibleOrders.length === 0 ? (
          <div className="rounded-[6px] border border-ink-100 bg-ink-50 px-4 py-10 text-center text-[13px] text-ink-500">
            {activeFilter === 'Open'
              ? 'No grocery orders in flight. Quiet queue.'
              : 'No grocery orders match this filter.'}
          </div>
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Placed</Th>
                <Th>Source</Th>
                <Th>Recipient · Store</Th>
                <Th>Items</Th>
                <Th align="right">Total</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {visibleOrders.map((order) => {
                const storeLine = formatStore(order.store);
                const itemsTotal = itemCount(order.lineItems);
                const totalCents =
                  order.chargedAmountCents ?? order.paymentIntent?.amount ?? 0;
                const status = (order.status || 'created').toLowerCase();
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
                      <div className="text-[11px] text-ink-400">{order.senderName || '—'}</div>
                    </Td>
                    <Td className="text-ink-700">{timeAgo(order.createdAt, nowMs)}</Td>
                    <Td>{sourcePill(order.source)}</Td>
                    <Td>
                      <div className="leading-tight">
                        <div>{order.recipient?.name || <Dash />}</div>
                        {storeLine ? (
                          <div className="text-[11px] text-ink-400">{storeLine}</div>
                        ) : null}
                      </div>
                    </Td>
                    <Td>{itemsTotal > 0 ? `${itemsTotal} items` : <Dash />}</Td>
                    <Td align="right" className="font-num tnum">
                      {formatMoney({ cents: totalCents, currency: 'usd' })}
                    </Td>
                    <Td>
                      {status === 'cancelled' ? (
                        <Pill tone="danger">Cancelled</Pill>
                      ) : (
                        <Pill tone="neutral">Created</Pill>
                      )}
                    </Td>
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
