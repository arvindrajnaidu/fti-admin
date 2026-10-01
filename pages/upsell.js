import { useEffect, useState, useCallback, useMemo } from 'react';
import Head from 'next/head';
import { ArrowClockwise } from '@phosphor-icons/react';
import { AdminShell } from '../components/layout/AdminShell';
import { PageHeader } from '../components/layout/PageHeader';
import { StatCard } from '../components/data/StatCard';
import { TableShell, Th, Tr, Td, Pill, Dash } from '../components/data/DataTable';
import {
  STANDARD_RANGES,
  isCustomRangeLabel,
  rangeQueryParams,
  toIsoDate,
} from '../lib/dateRange';

const DAY_MS = 24 * 60 * 60 * 1000;

// Days back to seed the custom pickers from, per preset, when switching to
// Custom so the form opens on the range the user was already looking at.
const SEED_DAYS_BACK = {
  'Last 7d': 7,
  '1 month': 30,
  '3 months': 90,
  'Last 1y': 365,
  YTD: null, // seeded from Jan 1 instead
};

function fmtUSD(n) {
  return '$' + (n || 0).toFixed(2);
}

function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function fmtPct(n) {
  return (n * 100).toFixed(1) + '%';
}

export default function UpsellPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [environment, setEnvironment] = useState('dev');
  const [range, setRange] = useState('Last 7d');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const isCustom = isCustomRangeLabel(range);
  const today = toIsoDate(new Date());
  const rangeInvalid = isCustom && fromDate && toDate && fromDate > toDate;
  const customIncomplete = isCustom && (!fromDate || !toDate);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/environment');
        if (res.ok) setEnvironment((await res.json()).environment);
      } catch {}
    })();
  }, []);

  const fetchData = useCallback(async (params, force = false) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams(params);
      if (force) qs.set('forceRefresh', 'true');
      const res = await fetch(`/api/upsell-impact?${qs.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // The active query params, or null when a custom range isn't usable yet.
  // Custom ranges and YTD both carry startMs/endMs, the picked days' epoch
  // boundaries in the viewer's own timezone, so the range means the same
  // calendar days the viewer selected whatever timezone the server runs in.
  const queryParams = useMemo(() => {
    if (rangeInvalid || customIncomplete) return null;
    return rangeQueryParams(range, { custom: { from: fromDate, to: toDate } });
  }, [range, fromDate, toDate, customIncomplete, rangeInvalid]);

  useEffect(() => {
    if (!queryParams) {
      setLoading(false);
      return;
    }
    fetchData(queryParams);
  }, [queryParams, fetchData]);

  const handleRangeChange = (label) => {
    if (isCustomRangeLabel(label)) {
      if (isCustom) return;
      // Seed the pickers from the currently active preset so the switch shows
      // data immediately instead of an empty form.
      if (!fromDate) {
        const back = SEED_DAYS_BACK[range];
        setFromDate(
          back == null
            ? toIsoDate(new Date(new Date().getFullYear(), 0, 1))
            : toIsoDate(new Date(Date.now() - back * DAY_MS)),
        );
      }
      if (!toDate) setToDate(today);
    }
    setRange(label);
  };

  return (
    <>
      <Head><title>Upsell - FoodtoIndia Admin</title></Head>
      <AdminShell environment={environment}>
        <PageHeader
          title="Upsell Strip"
          description={`Orders where a customer added an item from the "Complete the meal" strip.`}
          actions={
            <button
              type="button"
              onClick={() => queryParams && fetchData(queryParams, true)}
              disabled={loading || !queryParams}
              className="inline-flex items-center gap-1.5 rounded-[6px] border border-ink-200 bg-ink-0 px-3 py-1.5 text-[13px] text-ink-700 transition-colors hover:bg-ink-50 disabled:opacity-50"
            >
              <ArrowClockwise className={'h-3.5 w-3.5 ' + (loading ? 'animate-spin' : '')} weight="regular" />
              Refresh
            </button>
          }
        />

        {/* Window selector */}
        <div className="mb-8 flex flex-wrap items-center gap-2">
          {STANDARD_RANGES.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => handleRangeChange(label)}
              className={
                'rounded-[6px] px-3 py-1 text-[12px] font-medium transition-colors ' +
                (range === label
                  ? 'bg-accent text-white'
                  : 'border border-ink-200 text-ink-600 hover:bg-ink-50')
              }
            >
              {label}
            </button>
          ))}

          {isCustom ? (
            <div className="flex items-center gap-2 rounded-[6px] border border-ink-200 bg-ink-0 px-2.5 py-1">
              <input
                type="date"
                aria-label="From date"
                value={fromDate}
                max={toDate || today}
                onChange={(e) => setFromDate(e.target.value)}
                className="bg-transparent text-[12px] text-ink-900 focus:outline-none"
              />
              <span className="text-[12px] text-ink-400">to</span>
              <input
                type="date"
                aria-label="To date"
                value={toDate}
                min={fromDate || undefined}
                max={today}
                onChange={(e) => setToDate(e.target.value)}
                className="bg-transparent text-[12px] text-ink-900 focus:outline-none"
              />
            </div>
          ) : null}
        </div>

        {rangeInvalid ? (
          <div className="rounded-[8px] border border-danger-weak bg-danger-weak/40 px-4 py-3 text-[13px] text-danger">
            &ldquo;From&rdquo; date must be on or before the &ldquo;To&rdquo; date.
          </div>
        ) : customIncomplete ? (
          <div className="rounded-[10px] border border-ink-100 bg-ink-50 px-5 py-8 text-center text-[13px] text-ink-500">
            Pick a start and end date to run the report.
          </div>
        ) : error ? (
          <div className="rounded-[8px] border border-danger-weak bg-danger-weak/40 px-4 py-3 text-[13px] text-danger">
            Failed to load: {error}
          </div>
        ) : loading && !data ? (
          <div className="text-[13px] text-ink-500">Loading...</div>
        ) : data ? (
          <>
            {/* Stat row */}
            <div className="mb-10 grid grid-cols-2 gap-6 sm:grid-cols-4">
              <div className="rounded-[10px] border border-ink-100 bg-ink-0 px-5 py-4">
                <StatCard
                  label="Orders scanned"
                  value={String(data.ordersScanned)}
                  subtext={data.rangeLabel}
                />
              </div>
              <div className="rounded-[10px] border border-ink-100 bg-ink-0 px-5 py-4">
                <StatCard
                  label="Upsell orders"
                  value={String(data.ordersWithUpsell)}
                  subtext="added from strip"
                />
              </div>
              <div className="rounded-[10px] border border-ink-100 bg-ink-0 px-5 py-4">
                <StatCard
                  label="Attach rate"
                  value={fmtPct(data.attachRate)}
                  subtext="of orders in window"
                />
              </div>
              <div className="rounded-[10px] border border-ink-100 bg-ink-0 px-5 py-4">
                <StatCard
                  label="Upsell revenue"
                  value={fmtUSD(data.totalUpsellUSD)}
                  current={data.totalUpsellUSD}
                  subtext="incremental"
                />
              </div>
            </div>

            {data.ordersWithUpsell === 0 ? (
              <div className="rounded-[10px] border border-ink-100 bg-ink-50 px-5 py-8 text-center text-[13px] text-ink-500">
                No upsell items found in this window. The strip may not have been live long enough,
                or check a recent order with <code className="font-mono text-[12px]">_check-order-upsell.js</code>.
              </div>
            ) : (
              <div className="space-y-10">
                {/* Item breakdown */}
                <section>
                  <h3 className="mb-3 text-[11px] font-medium uppercase tracking-micro text-ink-500">
                    Item breakdown
                  </h3>
                  <TableShell>
                    <thead>
                      <tr>
                        <Th>Item</Th>
                        <Th>Category</Th>
                        <Th align="right">Qty added</Th>
                        <Th align="right">Revenue</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.itemBreakdown.map((item) => (
                        <Tr key={item.name}>
                          <Td className="font-medium">{item.name}</Td>
                          <Td>
                            <Pill tone="neutral">{item.category || '—'}</Pill>
                          </Td>
                          <Td align="right" className="font-num">{item.qty}</Td>
                          <Td align="right" className="font-num">{fmtUSD(item.totalUSD)}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </TableShell>
                </section>

                {/* Order list */}
                <section>
                  <h3 className="mb-3 text-[11px] font-medium uppercase tracking-micro text-ink-500">
                    Orders with upsell items
                  </h3>
                  <TableShell>
                    <thead>
                      <tr>
                        <Th>Date</Th>
                        <Th>Order ID</Th>
                        <Th>Upsell items</Th>
                        <Th align="right">Upsell value</Th>
                        <Th align="right">Order total</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.orders.map((o) => (
                        <Tr key={o.orderId}>
                          <Td className="text-ink-500">{fmtDate(o.createdAtMs)}</Td>
                          <Td>
                            <code className="font-mono text-[12px] text-ink-700">{o.orderId}</code>
                          </Td>
                          <Td>
                            <div className="flex flex-wrap gap-1">
                              {o.upsellItems.map((it, i) => (
                                <Pill key={i} tone="accent">{it.name}</Pill>
                              ))}
                            </div>
                          </Td>
                          <Td align="right" className="font-num text-success font-medium">
                            +{fmtUSD(o.upsellValueUSD)}
                          </Td>
                          <Td align="right" className="font-num">{fmtUSD(o.totalAmountUSD)}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </TableShell>
                </section>
              </div>
            )}
          </>
        ) : null}
      </AdminShell>
    </>
  );
}
