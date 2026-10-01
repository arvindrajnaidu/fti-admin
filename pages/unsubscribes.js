import { useEffect, useState } from 'react';
import Head from 'next/head';
import { Banner, Button, Loader } from '@cloudflare/kumo';
import { Prohibit } from '@phosphor-icons/react';
import { withAuth } from '../lib/withAuth';
import { toTitleCase } from '../lib/titleCase';
import { AdminShell } from '../components/layout/AdminShell';
import { PageHeader } from '../components/layout/PageHeader';
import { StatCard } from '../components/data/StatCard';
import { TableShell, Th, Tr, Td, Pill } from '../components/data/DataTable';

const DAY_MS = 24 * 60 * 60 * 1000;

const formatWhen = (ms) => {
  if (!ms) return '-';
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

const formatRelative = (ms) => {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const d = Math.floor(diff / DAY_MS);
  if (d < 1) return 'today';
  if (d < 30) return `${d}d ago`;
  const months = Math.floor(d / 30);
  return `${months}mo ago`;
};

export default function UnsubscribesPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRows = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/unsubscribes');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Failed to load unsubscribes');
      setRows(data.unsubscribes || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRows(); }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await fetchRows(); } finally { setRefreshing(false); }
  };

  const total = rows.length;
  const last30d = rows.filter((r) => r.unsubscribedAt && Date.now() - r.unsubscribedAt < 30 * DAY_MS).length;
  const repeatCustomers = rows.filter((r) => r.orderCount >= 2).length;

  return (
    <AdminShell>
      <Head>
        <title>FoodtoIndia Admin - Unsubscribes</title>
      </Head>

      <PageHeader
        icon={Prohibit}
        title="Unsubscribes"
        subtitle="Everyone opted out of marketing emails, with their order history at the time"
        actions={
          <Button variant="secondary" size="sm" onClick={handleRefresh} disabled={refreshing || loading}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        }
      />

      <div className="mb-8 grid grid-cols-2 gap-x-8 gap-y-6 md:grid-cols-3">
        <StatCard label="Total unsubscribed" value={total.toString()} />
        <StatCard label="Last 30 days" value={last30d.toString()} />
        <StatCard label="Were repeat customers" value={repeatCustomers.toString()} subtext="2+ orders" />
      </div>

      {error ? <Banner variant="danger" className="mb-6">{error}</Banner> : null}

      {loading ? (
        <div className="flex justify-center py-16"><Loader /></div>
      ) : null}

      {!loading && !error && rows.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-[13px] text-ink-500">No unsubscribes recorded</p>
        </div>
      ) : null}

      {!loading && !error && rows.length > 0 ? (
        <TableShell>
          <thead>
            <tr>
              <Th>Unsubscribed</Th>
              <Th>Customer</Th>
              <Th align="right">Orders</Th>
              <Th>Last order</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Tr key={row.uid}>
                <Td>
                  <div>{formatWhen(row.unsubscribedAt)}</div>
                  <div className="text-[11px] text-ink-400">{formatRelative(row.unsubscribedAt)}</div>
                </Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{toTitleCase(row.name) || '-'}</span>
                    {row.isGuest ? <Pill tone="neutral">Guest</Pill> : null}
                  </div>
                  <div className="text-[12px] text-ink-500">{row.email || '-'}</div>
                </Td>
                <Td align="right" className="font-num">{row.orderCount}</Td>
                <Td>
                  <div>{formatWhen(row.lastOrderAt)}</div>
                  <div className="text-[11px] text-ink-400">{formatRelative(row.lastOrderAt)}</div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>
      ) : null}
    </AdminShell>
  );
}

export const getServerSideProps = withAuth();
