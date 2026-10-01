import { useEffect, useState } from 'react';
import Head from 'next/head';
import { Banner, Button, Loader } from '@cloudflare/kumo';
import { Gift } from '@phosphor-icons/react';
import { withAuth } from '../lib/withAuth';
import { AdminShell } from '../components/layout/AdminShell';
import { PageHeader } from '../components/layout/PageHeader';
import { StatCard } from '../components/data/StatCard';
import { TableShell, Th, Tr, Td, Pill, Dash } from '../components/data/DataTable';

const formatDate = (ms) => {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const formatDateTime = (ms) => {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;

export default function ReferralPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [environment, setEnvironment] = useState('dev');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/environment');
        if (res.ok) setEnvironment((await res.json()).environment);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    fetchInsights();
  }, []);

  const fetchInsights = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/referral-insights${force ? '?forceRefresh=true' : ''}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Failed to load referral insights');
      }
      setData(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchInsights(true);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <AdminShell environment={environment}>
      <Head>
        <title>FoodtoIndia Admin — Referrals</title>
      </Head>

      <PageHeader
        icon={Gift}
        title="Referrals"
        subtitle="Who referred whom, and which orders used referral credit"
        actions={
          <Button variant="secondary" size="sm" onClick={handleRefresh} disabled={refreshing || loading}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        }
      />

      {error ? (
        <Banner variant="danger" className="mb-6">
          {error}
        </Banner>
      ) : null}

      {loading && !data ? (
        <div className="flex justify-center py-16">
          <Loader />
        </div>
      ) : null}

      {data ? <ReferralContent data={data} /> : null}
    </AdminShell>
  );
}

function ReferralContent({ data }) {
  const { totals, referrals, redemptions } = data;

  return (
    <div className="flex flex-col gap-10">
      <Section title="Overview">
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total referrals"
            value={String(totals.totalReferrals)}
            current={totals.totalReferrals}
            subtext={totals.totalReferrals === 0 ? 'none yet' : 'all-time'}
          />
          <StatCard
            label="Completed"
            value={String(totals.completed)}
            current={totals.completed}
            subtext="referee placed first order"
          />
          <StatCard
            label="Pending"
            value={String(totals.pending)}
            current={totals.pending}
            subtext="signed up, no order yet"
          />
          <StatCard
            label="Credits redeemed"
            value={usd(totals.creditsRedeemedUSD)}
            current={totals.creditsRedeemedUSD}
            subtext={`${usd(totals.creditsEarnedUSD)} earned`}
          />
        </div>
      </Section>

      <Section title={`Referrals (${referrals.length})`}>
        {referrals.length === 0 ? (
          <EmptyRow>No referrals yet.</EmptyRow>
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>Referrer</Th>
                <Th>Referee</Th>
                <Th>Code</Th>
                <Th>Status</Th>
                <Th>Trigger order</Th>
                <Th align="right">Referred</Th>
              </tr>
            </thead>
            <tbody>
              {referrals.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <div className="text-[13px] text-ink-900">{r.referrerName || r.referrerEmail || '—'}</div>
                    {r.referrerName && r.referrerEmail ? (
                      <div className="text-[11px] text-ink-400">{r.referrerEmail}</div>
                    ) : null}
                  </Td>
                  <Td>
                    <div className="text-[13px] text-ink-900">{r.refereeName || r.refereeEmail || '—'}</div>
                    {r.refereeName && r.refereeEmail ? (
                      <div className="text-[11px] text-ink-400">{r.refereeEmail}</div>
                    ) : null}
                  </Td>
                  <Td className="font-mono text-[12px] text-ink-700">{r.referrerCode || <Dash />}</Td>
                  <Td>
                    <Pill tone={r.status === 'completed' ? 'success' : 'warn'}>{r.status}</Pill>
                  </Td>
                  <Td className="font-mono text-[12px]">
                    {r.triggerOrderId ? r.triggerOrderId.slice(0, 10) : <Dash />}
                  </Td>
                  <Td align="right" className="font-num tnum text-[12px] text-ink-500">
                    {formatDate(r.referralCreatedAt)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Section>

      <Section title={`Credit redemptions (${redemptions.length})`}>
        {redemptions.length === 0 ? (
          <EmptyRow>No referral credit has been redeemed yet.</EmptyRow>
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th>Order</Th>
                <Th align="right">Credit used</Th>
                <Th align="right">When</Th>
              </tr>
            </thead>
            <tbody>
              {redemptions.map((x) => (
                <Tr key={x.id}>
                  <Td>
                    <div className="text-[13px] text-ink-900">{x.customerName || x.customerEmail || '—'}</div>
                    {x.customerName && x.customerEmail ? (
                      <div className="text-[11px] text-ink-400">{x.customerEmail}</div>
                    ) : null}
                  </Td>
                  <Td className="font-mono text-[12px]">
                    {x.orderId ? x.orderId.slice(0, 10) : <Dash />}
                  </Td>
                  <Td align="right" className="font-num tnum text-[13px] font-medium text-success">
                    -{usd(x.amountUSD)}
                  </Td>
                  <Td align="right" className="font-num tnum text-[12px] text-ink-500">
                    {formatDateTime(x.timestamp)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section>
      <h2 className="mb-4 text-[15px] font-medium text-ink-900">{title}</h2>
      {children}
    </section>
  );
}

function EmptyRow({ children }) {
  return (
    <div className="rounded-[8px] border border-dashed border-ink-200 bg-ink-50 px-4 py-6 text-center text-[13px] text-ink-500">
      {children}
    </div>
  );
}

export const getServerSideProps = withAuth();
