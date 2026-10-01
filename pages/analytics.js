import { useEffect, useState } from 'react';
import Head from 'next/head';
import { Banner, Button, DatePicker, Loader } from '@cloudflare/kumo';
import { ChartLineUp } from '@phosphor-icons/react';
import { withAuth } from '../lib/withAuth';
import { STANDARD_RANGES, isCustomRangeLabel, rangeQueryParams } from '../lib/dateRange';
import { AdminShell } from '../components/layout/AdminShell';
import { PageHeader } from '../components/layout/PageHeader';
import { StatCard } from '../components/data/StatCard';
import { TableShell, Th, Tr, Td } from '../components/data/DataTable';
import { TrendChart } from '../components/data/TrendChart';

// Trackwork pattern: PageHeader filter options are display strings, used directly.
// The shared set, plus the two month/quarter-to-date views that only make sense
// on an analytics surface. Custom stays last.
const TIME_RANGE_FILTERS = [
  ...STANDARD_RANGES.filter((r) => r !== 'Custom'),
  'MTD',
  'QTD',
  'Custom',
];

// Revenue / LTV arrive from /api/analytics/kpis already in USD, converted per
// order at each order's own rate (see lib/currency.js).
const formatCurrency = (usd) => `$${Number(usd || 0).toFixed(2)}`;

const formatNumber = (num) => {
  if (!num) return '0';
  return num.toLocaleString();
};

const formatPercent = (value) => {
  if (!value) return '0%';
  return `${value.toFixed(1)}%`;
};

function generateInsights(kpis) {
  if (!kpis) return [];
  const critical = [];
  const warnings = [];
  const positive = [];

  if (kpis.customers.churnRate > 50) {
    critical.push({
      tone: 'danger',
      message: `${kpis.customers.churnRate.toFixed(1)}% churn rate — ${kpis.customers.churned} customers haven't ordered in 60+ days. Urgent: run reactivation campaign.`,
    });
  }

  if (kpis.growth.previousNewCustomers > 0) {
    const change =
      ((kpis.growth.newCustomers - kpis.growth.previousNewCustomers) /
        kpis.growth.previousNewCustomers) *
      100;
    if (change < -20) {
      critical.push({
        tone: 'danger',
        message: `New customer acquisition down ${Math.abs(change).toFixed(1)}% vs last period — review marketing channels.`,
      });
    } else if (change > 20) {
      positive.push({
        tone: 'success',
        message: `New customers up ${change.toFixed(1)}% vs last period — acquisition is working.`,
      });
    }
  }

  if (kpis.customers.daysTo2ndOrder && kpis.customers.daysTo2ndOrder > 30) {
    warnings.push({
      tone: 'warn',
      message: `${Math.round(kpis.customers.daysTo2ndOrder)} days to 2nd order (target: <14). Consider a "second order" discount campaign.`,
    });
  }

  if (kpis.customers.reactivationRate < 5 && kpis.cohortBuckets?.dormant > 10) {
    warnings.push({
      tone: 'warn',
      message: `Only ${kpis.customers.reactivationRate.toFixed(1)}% reactivation rate — win-back emails may need improvement.`,
    });
  }

  const activePct = (kpis.customers.active / kpis.customers.total) * 100;
  if (activePct < 15) {
    warnings.push({
      tone: 'warn',
      message: `Only ${activePct.toFixed(1)}% of customers are active (${kpis.customers.active}/${kpis.customers.total}) — massive reactivation opportunity.`,
    });
  }

  if (kpis.orders.completionRate > 90) {
    positive.push({
      tone: 'success',
      message: `${kpis.orders.completionRate.toFixed(1)}% completion rate — operational health is strong.`,
    });
  }

  if (kpis.customers.repeatRate > 60) {
    positive.push({
      tone: 'success',
      message: `${kpis.customers.repeatRate.toFixed(1)}% repeat rate — customer loyalty is healthy.`,
    });
  }

  return [...critical, ...warnings, ...positive].slice(0, 4);
}

function toneToBar(tone) {
  if (tone === 'danger') return 'border-l-danger';
  if (tone === 'warn') return 'border-l-warn';
  return 'border-l-success';
}

export default function AnalyticsPage() {
  const [kpis, setKpis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [environment, setEnvironment] = useState('dev');
  const [timeRange, setTimeRange] = useState('1 month');
  const [refreshing, setRefreshing] = useState(false);
  const [customRange, setCustomRange] = useState(null);
  const [trendWindow, setTrendWindow] = useState('3m'); // '1m' | '3m' | '1y'

  const isCustom = isCustomRangeLabel(timeRange);
  const rangeLabel = isCustom ? 'custom' : timeRange.replace('Last ', '');

  useEffect(() => {
    fetchEnvironment();
  }, []);

  useEffect(() => {
    if (isCustom && (!customRange?.from || !customRange?.to)) {
      setLoading(false);
      return;
    }
    fetchKPIs();
  }, [timeRange, customRange]);

  const fetchEnvironment = async () => {
    try {
      const res = await fetch('/api/environment');
      if (res.ok) {
        const data = await res.json();
        setEnvironment(data.environment);
      }
    } catch (err) {
      console.error('Failed to fetch environment:', err);
    }
  };

  const fetchKPIs = async () => {
    setLoading(true);
    setError(null);
    try {
      // Custom ranges and the calendar presets (MTD/QTD/YTD) are both resolved
      // in the viewer's timezone here in the browser. nativePresets: this route
      // is the one with its own mtd/qtd/ytd branch. See lib/dateRange.
      const q = rangeQueryParams(timeRange, { custom: customRange, nativePresets: true });
      if (!q) return;
      const res = await fetch(`/api/analytics/kpis?${new URLSearchParams(q)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to fetch KPIs');
      }
      setKpis(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchKPIs();
    } finally {
      setRefreshing(false);
    }
  };

  const insights = generateInsights(kpis);

  return (
    <AdminShell environment={environment}>
      <Head>
        <title>FoodtoIndia Admin — Analytics</title>
      </Head>

      <PageHeader
        icon={ChartLineUp}
        title="Business Analytics & KPIs"
        subtitle="Key performance indicators and business metrics"
        actions={
          <div className="flex items-center gap-2">
            {isCustom ? (
              <DatePicker
                mode="range"
                value={customRange}
                onValueChange={setCustomRange}
              />
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing || loading}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        }
        filters={{
          active: timeRange,
          options: TIME_RANGE_FILTERS,
          onChange: setTimeRange,
        }}
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

      {!loading && !error && kpis ? (
        <div className="flex flex-col gap-10">
          {insights.length > 0 ? (
            <section>
              <h2 className="mb-3 text-[15px] font-medium text-ink-900">Quick insights</h2>
              <ul className="flex flex-col gap-1.5">
                {insights.map((insight, i) => (
                  <li
                    key={i}
                    className={`border-l-2 bg-ink-50 px-3 py-2 text-[13px] text-ink-800 ${toneToBar(insight.tone)}`}
                  >
                    {insight.message}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <Section title="Growth">
            <StatGrid>
              <StatCard
                label="New customers"
                value={formatNumber(kpis.growth.newCustomers)}
                current={kpis.growth.newCustomers}
                previous={kpis.growth.previousNewCustomers}
                rangeLabel={rangeLabel}
                subtext="first order in period"
              />
              <StatCard
                label="Returning this period"
                value={formatNumber(kpis.growth.returningCustomers)}
                current={kpis.growth.returningCustomers}
                previous={kpis.growth.previousReturningCustomers}
                rangeLabel={rangeLabel}
                subtext="ordered before + again"
              />
              <StatCard
                label="New vs returning"
                value={`${formatNumber(kpis.growth.newCustomers)} / ${formatNumber(kpis.growth.returningCustomers)}`}
                subtext={
                  kpis.growth.returningCustomers > 0
                    ? `${(
                        (kpis.growth.returningCustomers /
                          (kpis.growth.newCustomers + kpis.growth.returningCustomers)) *
                        100
                      ).toFixed(1)}% returning`
                    : 'all new customers'
                }
              />
            </StatGrid>
          </Section>

          <Section title="Revenue">
            <StatGrid>
              <StatCard
                label="Total revenue"
                value={formatCurrency(kpis.revenue.total)}
                current={kpis.revenue.total}
                previous={kpis.revenue.previous}
                rangeLabel={rangeLabel}
                subtext={`${formatNumber(kpis.orders.total)} orders`}
              />
              <StatCard
                label="Avg order value"
                value={formatCurrency(kpis.revenue.avgOrderValue)}
                current={kpis.revenue.avgOrderValue}
                previous={kpis.revenue.previousAOV}
                rangeLabel={rangeLabel}
                subtext="per order"
              />
              <StatCard
                label="Revenue / active customer"
                value={formatCurrency(kpis.revenue.revenuePerActiveCustomer)}
                current={kpis.revenue.revenuePerActiveCustomer}
                previous={kpis.revenue.previousRevenuePerActive}
                rangeLabel={rangeLabel}
              />
            </StatGrid>
          </Section>

          {kpis.timeseries ? (() => {
            const TREND_WINDOWS = [
              { value: '1m', label: '1M',  granularity: 'weekly',  take: 4,  granLabel: 'weekly' },
              { value: '3m', label: '3M',  granularity: 'weekly',  take: 12, granLabel: 'weekly' },
              { value: '1y', label: '1Y',  granularity: 'monthly', take: 12, granLabel: 'monthly' },
            ];
            const opt = TREND_WINDOWS.find((o) => o.value === trendWindow) ?? TREND_WINDOWS[1];
            const currentKey = opt.granularity; // 'weekly' | 'monthly'
            const priorKey = opt.granularity === 'weekly' ? 'priorWeekly' : 'priorMonthly';
            const currentData = (kpis.timeseries[currentKey] || []).slice(-opt.take);
            const priorData = (kpis.timeseries[priorKey] || []).slice(-opt.take);
            return (
              <Section
                title="Trends"
                action={
                  <div className="inline-flex items-center gap-px rounded-[6px] border border-ink-100 bg-ink-50 p-0.5">
                    {TREND_WINDOWS.map((o) => {
                      const active = trendWindow === o.value;
                      return (
                        <button
                          key={o.value}
                          type="button"
                          onClick={() => setTrendWindow(o.value)}
                          className={
                            'rounded-[4px] px-2.5 py-1 text-[12px] font-medium transition-colors ' +
                            (active
                              ? 'bg-ink-0 text-ink-900 shadow-[0_1px_2px_rgba(11,14,20,0.06)]'
                              : 'text-ink-500 hover:text-ink-900')
                          }
                        >
                          {o.label}
                          <span className="ml-1 text-[10px] text-ink-400">{o.granLabel}</span>
                        </button>
                      );
                    })}
                  </div>
                }
              >
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <TrendCard
                    label="Orders"
                    data={currentData}
                    prior={priorData}
                    valueKey="orders"
                    format={(v) => formatNumber(v)}
                    tone="ink"
                  />
                  <TrendCard
                    label="Revenue"
                    data={currentData}
                    prior={priorData}
                    valueKey="revenue"
                    format={(v) => formatCurrency(v)}
                    tone="accent"
                  />
                </div>
              </Section>
            );
          })() : null}

          <Section title="Customer health">
            <StatGrid>
              <StatCard
                label="Active customers"
                value={formatNumber(kpis.customers.active)}
                current={kpis.customers.active}
                previous={kpis.customers.previousActive}
                rangeLabel={rangeLabel}
                subtext={`${((kpis.customers.active / kpis.customers.total) * 100).toFixed(1)}% of ${kpis.customers.total}`}
              />
              <StatCard
                label="Repeat rate"
                value={formatPercent(kpis.customers.repeatRate)}
                current={kpis.customers.repeatRate}
                previous={kpis.customers.previousRepeatRate}
                rangeLabel={rangeLabel}
                subtext={`${formatNumber(kpis.customers.repeat)} repeat`}
              />
              <StatCard
                label="Churn rate 60d"
                value={formatPercent(kpis.customers.churnRate)}
                current={kpis.customers.churnRate}
                previous={kpis.customers.previousChurnRate}
                rangeLabel={rangeLabel}
                reverseTrendColors
                subtext={`${formatNumber(kpis.customers.churned)} churned`}
              />
              <StatCard
                label="Reactivation rate"
                value={formatPercent(kpis.customers.reactivationRate)}
                current={kpis.customers.reactivationRate}
                previous={kpis.customers.previousReactivationRate}
                rangeLabel={rangeLabel}
                subtext={`${formatNumber(kpis.customers.reactivated)} reactivated`}
              />
              <StatCard
                label="Customer LTV"
                value={formatCurrency(kpis.customers.ltv)}
                current={kpis.customers.ltv}
                previous={kpis.customers.previousLTV}
                rangeLabel={rangeLabel}
                subtext="per customer"
              />
              <StatCard
                label="Days to 2nd order"
                value={
                  kpis.customers.daysTo2ndOrder
                    ? Math.round(kpis.customers.daysTo2ndOrder).toString()
                    : '—'
                }
                current={kpis.customers.daysTo2ndOrder}
                previous={kpis.customers.previousDaysTo2nd}
                rangeLabel={rangeLabel}
                reverseTrendColors
                subtext="target <14 days"
              />
            </StatGrid>
          </Section>

          {kpis.cohortBuckets ? (
            <Section title="Customer pipeline">
              <div className="flex flex-wrap items-center justify-around gap-4 py-2">
                <PipelineBucket
                  label="New"
                  count={kpis.cohortBuckets.new}
                  sub="<30 days"
                  color="text-accent"
                />
                <PipelineArrow />
                <PipelineBucket
                  label="At risk"
                  count={kpis.cohortBuckets.atRisk}
                  sub="30–60 days"
                  color="text-warn"
                />
                <PipelineArrow />
                <PipelineBucket
                  label="Dormant"
                  count={kpis.cohortBuckets.dormant}
                  sub="60–90 days"
                  color="text-warn"
                />
                <PipelineArrow />
                <PipelineBucket
                  label="Churned"
                  count={kpis.cohortBuckets.churned}
                  sub="90+ days"
                  color="text-danger"
                />
              </div>
            </Section>
          ) : null}

          <Section title="Operations">
            <StatGrid>
              <StatCard
                label="Total orders"
                value={formatNumber(kpis.orders.total)}
                current={kpis.orders.total}
                previous={kpis.orders.previous}
                rangeLabel={rangeLabel}
              />
              <StatCard
                label="Completion rate"
                value={formatPercent(kpis.orders.completionRate)}
                current={kpis.orders.completionRate}
                previous={kpis.orders.previousCompletionRate}
                rangeLabel={rangeLabel}
                subtext={`${formatNumber(kpis.orders.dispatched)} dispatched`}
              />
              <StatCard
                label="Cancellation rate"
                value={formatPercent(kpis.orders.cancellationRate)}
                current={kpis.orders.cancellationRate}
                previous={kpis.orders.previousCancellationRate}
                rangeLabel={rangeLabel}
                reverseTrendColors
                subtext={`${formatNumber(kpis.orders.cancelled)} cancelled`}
              />
            </StatGrid>
          </Section>

          {kpis.cohorts && kpis.cohorts.length > 0 ? (
            <Section title="Customer cohorts">
              <TableShell>
                <thead>
                  <tr>
                    <Th>Cohort month</Th>
                    <Th>New customers</Th>
                    <Th>Total orders</Th>
                    <Th>Total revenue</Th>
                    <Th>Avg LTV</Th>
                    <Th>Repeat rate</Th>
                  </tr>
                </thead>
                <tbody>
                  {kpis.cohorts.map((c) => (
                    <Tr key={c.month}>
                      <Td>{c.month}</Td>
                      <Td className="font-num">{formatNumber(c.customers)}</Td>
                      <Td className="font-num">{formatNumber(c.orders)}</Td>
                      <Td className="font-num">{formatCurrency(c.revenue)}</Td>
                      <Td className="font-num">{formatCurrency(c.avgLTV)}</Td>
                      <Td className="font-num">{formatPercent(c.repeatRate)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </TableShell>
            </Section>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-ink-400">
            <span>
              Last updated{' '}
              {kpis.metadata?.calculatedAt
                ? new Date(kpis.metadata.calculatedAt).toLocaleString()
                : new Date().toLocaleString()}
            </span>
            <span>Data refreshes every 5 minutes</span>
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}

function Section({ title, action, children }) {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-medium text-ink-900">{title}</h2>
        {action ? <div>{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function TrendCard({ label, data, prior, valueKey, format, tone }) {
  const total = data.reduce((sum, d) => sum + (Number(d[valueKey]) || 0), 0);
  const priorTotal = (prior || []).reduce(
    (sum, d) => sum + (Number(d[valueKey]) || 0),
    0,
  );
  const hasDelta = priorTotal !== 0;
  const change = hasDelta ? ((total - priorTotal) / priorTotal) * 100 : 0;
  const good = change >= 0;

  return (
    <div className="rounded-[8px] border border-ink-100 bg-ink-0 p-5">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-micro text-ink-500">
            {label}
          </div>
          <div className="mt-2 font-num text-[22px] font-medium leading-none text-ink-900">
            {format(total)}
          </div>
          <div className="mt-1 text-[11px] text-ink-400">Period total</div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-medium uppercase tracking-micro text-ink-500">
            vs prior period
          </div>
          <div className="mt-2 font-num text-[18px] font-medium leading-none text-ink-400">
            {format(priorTotal)}
          </div>
          {hasDelta ? (
            <div className={`mt-1 text-[11px] font-medium ${good ? 'text-success' : 'text-danger'}`}>
              {change >= 0 ? '+' : ''}
              {change.toFixed(1)}%
            </div>
          ) : (
            <div className="mt-1 text-[11px] text-ink-400">—</div>
          )}
        </div>
      </div>
      <TrendChart
        data={data}
        prior={prior}
        valueKey={valueKey}
        format={format}
        tone={tone}
      />
    </div>
  );
}

function StatGrid({ children }) {
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {children}
    </div>
  );
}

function PipelineBucket({ label, count, sub, color }) {
  return (
    <div className="text-center">
      <div className="text-[11px] uppercase tracking-micro text-ink-500">{label}</div>
      <div className={`font-num mt-2 text-[34px] font-medium leading-none ${color}`}>
        {count}
      </div>
      <div className="mt-2 text-[11px] text-ink-400">{sub}</div>
    </div>
  );
}

function PipelineArrow() {
  return <div className="text-[20px] text-ink-300">→</div>;
}

export const getServerSideProps = withAuth();
