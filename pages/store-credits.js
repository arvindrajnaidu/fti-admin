import { useEffect, useState } from 'react';
import Head from 'next/head';
import { Banner, Button, Loader } from '@cloudflare/kumo';
import { withAuth } from '../lib/withAuth';
import { Wallet } from '@phosphor-icons/react';
import { AdminShell } from '../components/layout/AdminShell';
import { PageHeader } from '../components/layout/PageHeader';
import { StatCard } from '../components/data/StatCard';
import { TableShell, Th, Tr, Td, Dash, Pill } from '../components/data/DataTable';

const STATUS_FILTERS = ['all', 'active', 'redeemed', 'expired', 'revoked'];

const STATUS_PILL = {
  active: 'success',
  redeemed: 'accent',
  expired: 'danger',
  revoked: 'neutral',
};

function getCreditStatus(credit) {
  if (credit.totalRedemptions > 0) return 'redeemed';
  if (!credit.isActive) return 'revoked';
  if (credit.expiresAt && new Date(credit.expiresAt) < new Date()) return 'expired';
  return 'active';
}

const fmtUsd = (cents) => `$${(cents / 100).toFixed(2)}`;
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString() : null);

export default function StoreCreditsPage() {
  const [credits, setCredits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [environment, setEnvironment] = useState('dev');
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    fetchCredits();
    fetch('/api/environment')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setEnvironment(d.environment))
      .catch(() => {});
  }, []);

  const fetchCredits = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/store-credits');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to fetch store credits');
      }
      const data = await res.json();
      setCredits(data.credits || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchCredits();
    } finally {
      setRefreshing(false);
    }
  };

  const handleRevoke = async (credit) => {
    if (!confirm(`Revoke store credit ${credit.code} (${fmtUsd(credit.value)}) for ${credit.customerEmail}?`)) return;
    try {
      const res = await fetch('/api/promo-codes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: credit.id, isActive: false }),
      });
      if (res.ok) {
        setCredits((prev) =>
          prev.map((c) => (c.id === credit.id ? { ...c, isActive: false } : c)),
        );
      } else {
        alert('Failed to revoke store credit');
      }
    } catch (err) {
      alert('Failed to revoke: ' + err.message);
    }
  };

  const filteredCredits = credits.filter((c) =>
    statusFilter === 'all' ? true : getCreditStatus(c) === statusFilter,
  );

  const totalIssued = credits.length;
  const totalRedeemed = credits.filter((c) => c.totalRedemptions > 0).length;
  const totalActive = credits.filter((c) => getCreditStatus(c) === 'active').length;
  const totalOutstandingCents = credits
    .filter((c) => getCreditStatus(c) === 'active')
    .reduce((sum, c) => sum + c.value, 0);

  return (
    <AdminShell environment={environment}>
      <Head>
        <title>FoodtoIndia Admin — Store Credits</title>
      </Head>

      <PageHeader
        icon={Wallet}
        title="Store Credits"
        subtitle="Credits issued to customers. Behave like a personal promo code, valid for 1 year."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        }
      />

      <div className="mb-8 grid grid-cols-2 gap-x-8 gap-y-6 lg:grid-cols-4">
        <StatCard label="Total issued" value={totalIssued.toString()} />
        <StatCard label="Active" value={totalActive.toString()} />
        <StatCard label="Redeemed" value={totalRedeemed.toString()} />
        <StatCard label="Outstanding" value={fmtUsd(totalOutstandingCents)} />
      </div>

      <FilterTabs
        value={statusFilter}
        onChange={setStatusFilter}
        options={STATUS_FILTERS.map((status) => ({
          value: status,
          label: status,
          count:
            status === 'all'
              ? credits.length
              : credits.filter((c) => getCreditStatus(c) === status).length,
        }))}
      />

      {error ? (
        <Banner variant="danger" className="mb-6">
          {error}
        </Banner>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader />
        </div>
      ) : null}

      {!loading && !error ? (
        <TableShell>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Customer</Th>
              <Th align="right">Amount</Th>
              <Th>Reason</Th>
              <Th>Source order</Th>
              <Th>Issued by</Th>
              <Th>Date</Th>
              <Th>Expires</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {filteredCredits.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-[13px] text-ink-500">
                  No store credits found
                </td>
              </tr>
            ) : (
              filteredCredits.map((credit) => {
                const status = getCreditStatus(credit);
                return (
                  <Tr key={credit.id}>
                    <Td>
                      <code className="font-mono text-[12px] text-ink-900">{credit.code}</code>
                    </Td>
                    <Td>{credit.customerEmail}</Td>
                    <Td align="right" className="font-num font-medium">
                      {fmtUsd(credit.value)}
                    </Td>
                    <Td className="max-w-[220px] truncate text-ink-600" title={credit.reason}>
                      {credit.reason}
                    </Td>
                    <Td>
                      {credit.sourceOrderId ? (
                        <span className="font-mono text-[12px] text-ink-500">
                          {credit.sourceOrderId.slice(0, 8)}…
                        </span>
                      ) : (
                        <Dash />
                      )}
                    </Td>
                    <Td className="text-ink-600">{credit.issuedBy || <Dash />}</Td>
                    <Td className="text-ink-600">{fmtDate(credit.createdAt) || <Dash />}</Td>
                    <Td className="text-ink-600">{fmtDate(credit.expiresAt) || <Dash />}</Td>
                    <Td>
                      <Pill tone={STATUS_PILL[status] ?? 'neutral'}>{status}</Pill>
                    </Td>
                    <Td>
                      {status === 'active' ? (
                        <Button variant="ghost" size="sm" onClick={() => handleRevoke(credit)}>
                          Revoke
                        </Button>
                      ) : null}
                    </Td>
                  </Tr>
                );
              })
            )}
          </tbody>
        </TableShell>
      ) : null}
    </AdminShell>
  );
}

function FilterTabs({ value, onChange, options }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-1 border-b border-ink-100">
      {options.map((opt) => {
        const isActive = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={
              'relative px-3 py-2 text-[13px] capitalize transition-colors ' +
              (isActive
                ? 'text-ink-900 font-medium'
                : 'text-ink-500 hover:text-ink-900')
            }
          >
            {opt.label}
            <span className={`ml-1 text-[11px] ${isActive ? 'text-ink-500' : 'text-ink-400'}`}>
              ({opt.count})
            </span>
            {isActive ? (
              <span
                aria-hidden
                className="absolute inset-x-3 -bottom-px h-[2px] bg-accent"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export const getServerSideProps = withAuth();
