import { useEffect, useState } from 'react';
import Head from 'next/head';
import { Banner, Button, Loader } from '@cloudflare/kumo';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { withAuth } from '../lib/withAuth';
import { AdminShell } from '../components/layout/AdminShell';
import { PageHeader } from '../components/layout/PageHeader';
import { StatCard } from '../components/data/StatCard';
import { TrendChart } from '../components/data/TrendChart';
import { TableShell, Th, Tr, Td, Pill, Dash } from '../components/data/DataTable';

const SOURCE_LABELS = {
  google: 'Google search',
  ai_search: 'AI search (ChatGPT, Gemini, Claude)',
  social_media: 'Social media (Instagram, Twitter, TikTok)',
  friend: 'Friend told me',
  other: 'Other',
};
// Short labels for the per-respondent table pills (the full labels are
// too long to fit a pill).
const SOURCE_SHORT = {
  google: 'Google',
  ai_search: 'AI search',
  social_media: 'Social media',
  friend: 'Friend',
  other: 'Other',
};
// Order mirrors the survey options in
// foodtoindia/components/AttributionSurvey.js.
const SOURCE_ORDER = ['google', 'ai_search', 'social_media', 'friend', 'other'];

const formatPercent = (n, d) => (d === 0 ? '0%' : `${((n / d) * 100).toFixed(1)}%`);

const formatDate = (ms) => {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const formatDateTime = (ms) => {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const shortDay = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export default function AttributionPage() {
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
      const res = await fetch(`/api/attribution-insights${force ? '?forceRefresh=true' : ''}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Failed to load attribution insights');
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
        <title>FoodtoIndia Admin — Attribution</title>
      </Head>

      <PageHeader
        icon={MagnifyingGlass}
        title="Attribution survey"
        subtitle={`Where new customers heard about us · Live since May 4, 2026`}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing || loading}
          >
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

      {data ? <AttributionContent data={data} /> : null}
    </AdminShell>
  );
}

function AttributionContent({ data }) {
  const {
    totalResponses,
    droppedFraud,
    daysSinceLaunch,
    bySource,
    byDay,
    responses = [],
    otherResponses,
    friendReferrals,
  } = data;

  return (
    <div className="flex flex-col gap-10">
      <Section title="Overview">
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Total responses"
            value={String(totalResponses)}
            current={totalResponses}
            subtext={totalResponses === 0 ? 'no submissions yet' : 'first-order customers only'}
          />
          <StatCard
            label="Days since launch"
            value={String(daysSinceLaunch)}
            current={daysSinceLaunch}
            subtext={`launched ${data.launchedAt}`}
          />
          <StatCard
            label="Excluded"
            value={String(droppedFraud)}
            current={droppedFraud}
            subtext="fraud / test accounts"
          />
        </div>
        <p className="mt-4 text-[12px] text-ink-400">
          Response-rate denominator (first-order customers shown the survey) lives in PostHog as the
          <code className="mx-1 rounded bg-ink-50 px-1 py-0.5 font-mono text-[11px]">attribution_survey_shown</code>
          event. Not joined here.
        </p>
      </Section>

      <Section title="Source breakdown">
        <SourceBars bySource={bySource} total={totalResponses} />
      </Section>

      <Section title={`All responses (${responses.length})`}>
        {responses.length === 0 ? (
          <EmptyRow>No responses yet.</EmptyRow>
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th>Heard about us via</Th>
                <Th>Detail</Th>
                <Th align="right">Submitted</Th>
              </tr>
            </thead>
            <tbody>
              {responses.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <div className="text-[13px] text-ink-900">
                      {r.senderName || r.senderEmail || '—'}
                    </div>
                    {r.senderName && r.senderEmail ? (
                      <div className="text-[11px] text-ink-400">{r.senderEmail}</div>
                    ) : null}
                  </Td>
                  <Td>
                    <Pill tone={r.source === 'friend' ? 'success' : 'accent'}>
                      {SOURCE_SHORT[r.source] || r.source}
                    </Pill>
                  </Td>
                  <Td className="text-[12px] text-ink-700">
                    {r.source === 'other' ? (
                      r.customText || <span className="italic text-ink-400">(blank)</span>
                    ) : r.source === 'friend' ? (
                      [r.friendName, r.friendEmail].filter(Boolean).join(' · ') || <Dash />
                    ) : (
                      <Dash />
                    )}
                  </Td>
                  <Td align="right" className="font-num tnum text-[12px] text-ink-500">
                    {formatDateTime(r.createdAt)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Section>

      <Section title="Daily submissions">
        {byDay.length > 1 ? (
          <div className="rounded-[8px] border border-ink-100 bg-ink-0 p-5">
            <TrendChart
              data={byDay.map((b) => ({ label: shortDay(b.date), count: b.count }))}
              valueKey="count"
              tone="accent"
              format={(v) => `${v} response${v === 1 ? '' : 's'}`}
            />
          </div>
        ) : (
          <div className="rounded-[8px] border border-ink-100 bg-ink-0 p-5 text-[13px] text-ink-500">
            Not enough days yet to draw a trend.
          </div>
        )}
      </Section>

      <Section title={`"Other" verbatim (${otherResponses.length})`}>
        {otherResponses.length === 0 ? (
          <EmptyRow>No "other" responses yet.</EmptyRow>
        ) : (
          <ul className="flex flex-col gap-2">
            {otherResponses.map((r) => (
              <li
                key={r.id}
                className="flex items-baseline justify-between gap-4 rounded-[8px] border border-ink-100 bg-ink-0 px-4 py-3"
              >
                <span className="text-[13px] text-ink-900">
                  {r.customText || <span className="text-ink-400 italic">(blank)</span>}
                </span>
                <span className="shrink-0 font-num text-[12px] text-ink-400 tnum">
                  {formatDateTime(r.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Friend referrals (${friendReferrals.length})`}>
        {friendReferrals.length === 0 ? (
          <EmptyRow>No friend referrals yet.</EmptyRow>
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>Sender</Th>
                <Th>Friend name</Th>
                <Th>Friend email</Th>
                <Th>Thank-you</Th>
                <Th align="right">Submitted</Th>
              </tr>
            </thead>
            <tbody>
              {friendReferrals.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <div className="text-[13px] text-ink-900">{r.senderName || r.senderEmail || '—'}</div>
                    {r.senderName && r.senderEmail ? (
                      <div className="text-[11px] text-ink-400">{r.senderEmail}</div>
                    ) : null}
                  </Td>
                  <Td>{r.friendName || <Dash />}</Td>
                  <Td className="font-mono text-[12px]">{r.friendEmail || <Dash />}</Td>
                  <Td>
                    <ThankYouPill r={r} />
                  </Td>
                  <Td align="right" className="font-num tnum text-[12px] text-ink-500">
                    {formatDate(r.createdAt)}
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

function SourceBars({ bySource, total }) {
  const max = Math.max(...SOURCE_ORDER.map((k) => bySource[k] || 0), 1);
  return (
    <div className="rounded-[8px] border border-ink-100 bg-ink-0 p-5">
      <div className="flex flex-col gap-3">
        {SOURCE_ORDER.map((key) => {
          const count = bySource[key] || 0;
          const width = total === 0 ? 0 : (count / max) * 100;
          return (
            <div key={key} className="flex items-center gap-4">
              <div className="w-56 shrink-0 text-[13px] text-ink-700">{SOURCE_LABELS[key]}</div>
              <div className="flex-1">
                <div className="h-2 w-full rounded-full bg-ink-50">
                  <div
                    className="h-2 rounded-full bg-accent transition-all"
                    style={{ width: `${width}%` }}
                  />
                </div>
              </div>
              <div className="w-28 shrink-0 text-right">
                <span className="font-num text-[14px] font-medium text-ink-900 tnum">{count}</span>
                <span className="ml-2 font-num text-[12px] text-ink-400 tnum">
                  {formatPercent(count, total)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ThankYouPill({ r }) {
  if (!r.friendEmail) return <Pill tone="neutral">no email</Pill>;
  if (r.thankYouSentAt) return <Pill tone="success">sent</Pill>;
  if (r.thankYouFailed) return <Pill tone="danger">{r.thankYouFailReason || 'failed'}</Pill>;
  return <Pill tone="neutral">pending</Pill>;
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
