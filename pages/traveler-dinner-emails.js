import { useEffect, useState } from 'react';
import Head from 'next/head';
import { Banner, Button, Loader } from '@cloudflare/kumo';
import { X, PaperPlaneTilt, CheckCircle, ForkKnife } from '@phosphor-icons/react';
import { withAuth } from '../lib/withAuth';
import { toTitleCase } from '../lib/titleCase';
import { AdminShell } from '../components/layout/AdminShell';
import { PageHeader } from '../components/layout/PageHeader';
import { StatCard } from '../components/data/StatCard';
import { TableShell, Th, Tr, Td, Pill } from '../components/data/DataTable';

const formatWhen = (ms) => {
  if (!ms) return 'N/A';
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

const formatRelative = (ms) => {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const h = Math.floor(diff / 3600000);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
};

const COOLDOWN_MS = 2 * 24 * 60 * 60 * 1000;

// Hours until a person is off the 2-day cooldown, or 0 if already due.
const hoursUntilDue = (lastSentAt) => {
  if (!lastSentAt) return 0;
  const remaining = lastSentAt + COOLDOWN_MS - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 3600000) : 0;
};

// Stable key for tracking which rows have been sent this session.
const rowKey = (c) => `${c.uid}:${c.orderId}`;

export default function TravelerDinnerEmailsPage() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ scanned: 0, skippedCount: 0, skipReasons: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // Preview modal state
  const [selected, setSelected] = useState(null);   // candidate row
  const [preview, setPreview] = useState(null);      // { html, restaurants, eligible, reason }
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  // Send state
  const [confirmKey, setConfirmKey] = useState(null);
  const [sendingKey, setSendingKey] = useState(null);
  const [sendResult, setSendResult] = useState(null);
  const [sentKeys, setSentKeys] = useState({}); // rowKey -> sentAt

  // Batch send-all state (two-stage confirm, mirrors the per-person button)
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [batchSending, setBatchSending] = useState(false);
  const [batchResult, setBatchResult] = useState(null);

  const handleSendAll = async () => {
    setBatchSending(true);
    setBatchResult(null);
    try {
      const res = await fetch('/api/traveler-dinner/send-all', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Batch send failed');
      setBatchResult({ success: true, message: `Sent ${data.sent} of ${data.attempted} (${data.skipped} skipped, ${data.failed} failed)${data.remaining ? ` - ${data.remaining} still due, click again` : ""}` });
      await fetchCandidates(); // refresh cooldowns + history from the source of truth
    } catch (err) {
      setBatchResult({ success: false, message: err.message });
    } finally {
      setBatchSending(false);
      setBatchConfirm(false);
    }
  };

  useEffect(() => { fetchCandidates(); }, []);

  const fetchCandidates = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/traveler-dinner/candidates');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Failed to load candidates');
      setRows(data.candidates || []);
      setMeta({
        scanned: data.scanned || 0,
        skippedCount: data.skippedCount || 0,
        skipReasons: data.skipReasons || {},
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await fetchCandidates(); } finally { setRefreshing(false); }
  };

  const openPreview = async (row) => {
    setSelected(row);
    setPreview(null);
    setPreviewError(null);
    setConfirmKey(null);
    setSendResult(null);
    setTestResult(null);
    setPreviewLoading(true);
    try {
      const qs = new URLSearchParams({ uid: row.uid, orderId: row.orderId }).toString();
      const res = await fetch(`/api/traveler-dinner/preview?${qs}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Failed to build preview');
      setPreview(data);
    } catch (err) {
      setPreviewError(err.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    setSelected(null);
    setPreview(null);
    setPreviewError(null);
    setConfirmKey(null);
    setSendResult(null);
    setTestResult(null);
  };

  // Test send: same rendered email, delivered only to the hardcoded internal
  // test inbox. Never touches the customer's cooldown/history/rotation.
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const handleSendTest = async (row) => {
    setTestSending(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/traveler-dinner/send-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: row.uid, orderId: row.orderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Failed to send test');
      setTestResult({ success: true, message: `Test sent to ${data.sentTo}` });
    } catch (err) {
      setTestResult({ success: false, message: err.message });
    } finally {
      setTestSending(false);
    }
  };

  const handleSend = async (row) => {
    const key = rowKey(row);
    setSendingKey(key);
    setSendResult(null);
    try {
      const res = await fetch('/api/traveler-dinner/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: row.uid, orderId: row.orderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.reason || data.error || data.message || 'Failed to send');
      setSentKeys((prev) => ({ ...prev, [key]: data.sentAt }));
      setSendResult({ success: true, message: `Sent to ${data.sentTo}` });
      setConfirmKey(null);
    } catch (err) {
      setSendResult({ success: false, message: err.message });
    } finally {
      setSendingKey(null);
    }
  };

  const eligibleCount = rows.length;
  const dueCount = rows.filter(
    (r) => hoursUntilDue(sentKeys[rowKey(r)] || r.lastSentAt) === 0,
  ).length;

  return (
    <AdminShell>
      <Head>
        <title>FoodtoIndia Admin - Traveler Dinner Emails</title>
      </Head>

      <PageHeader
        icon={ForkKnife}
        title="Traveler Dinner Emails"
        subtitle="Traveler/self-order customers with a delivered order in the last 15 days. Re-sendable every 2 days while their trip lasts."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={handleRefresh} disabled={refreshing || loading}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
            {batchConfirm ? (
              <>
                <Button variant="secondary" size="sm" onClick={() => setBatchConfirm(false)} disabled={batchSending}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" onClick={handleSendAll} disabled={batchSending}>
                  {batchSending ? 'Sending…' : `Confirm send to ${dueCount} due`}
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setBatchConfirm(true)}
                disabled={loading || batchSending || dueCount === 0}
              >
                Send all eligible ({dueCount})
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-8 grid grid-cols-2 gap-x-8 gap-y-6 md:grid-cols-4">
        <StatCard label="In cohort" value={eligibleCount.toString()} subtext="travelers, last 15d" />
        <StatCard label="Due now" value={dueCount.toString()} subtext="off cooldown" />
        <StatCard label="Scanned" value={meta.scanned.toString()} subtext="users in last 15d" />
        <StatCard label="Skipped" value={meta.skippedCount.toString()} subtext="not eligible" />
      </div>

      {Object.keys(meta.skipReasons).length > 0 ? (
        <div className="mb-6 flex flex-wrap gap-2">
          {Object.entries(meta.skipReasons).map(([reason, count]) => (
            <span key={reason} className="rounded-[6px] bg-ink-50 px-2 py-1 text-[11px] text-ink-500">
              {reason}: <span className="font-medium text-ink-700">{count}</span>
            </span>
          ))}
        </div>
      ) : null}

      {error ? <Banner variant="danger" className="mb-6">{error}</Banner> : null}

      {batchResult ? (
        <Banner variant={batchResult.success ? 'success' : 'danger'} className="mb-6">
          {batchResult.message}
        </Banner>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-16"><Loader /></div>
      ) : null}

      {!loading && !error && rows.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-[13px] text-ink-500">No eligible traveler customers right now</p>
        </div>
      ) : null}

      {!loading && !error && rows.length > 0 ? (
        <TableShell>
          <thead>
            <tr>
              <Th>Order placed</Th>
              <Th>Customer</Th>
              <Th>City</Th>
              <Th>Last restaurant</Th>
              <Th>Last sent</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = rowKey(row);
              // Reflect a send made this session immediately, before refresh.
              const justSentAt = sentKeys[key];
              const lastSentAt = justSentAt || row.lastSentAt;
              const sendCount = (row.sendCount || 0) + (justSentAt ? 1 : 0);
              const dueInH = hoursUntilDue(lastSentAt);
              const onCooldown = dueInH > 0;
              return (
                <Tr key={key}>
                  <Td>
                    <div>{formatWhen(row.placedAt)}</div>
                    <div className="text-[11px] text-ink-400">{formatRelative(row.placedAt)}</div>
                  </Td>
                  <Td>
                    <div className="font-medium">{toTitleCase(row.senderName) || '-'}</div>
                    <div className="text-[12px] text-ink-500">{row.email}</div>
                  </Td>
                  <Td className="text-ink-600">{row.city || '-'}</Td>
                  <Td className="text-ink-600">{row.lastRestaurant || '-'}</Td>
                  <Td>
                    {lastSentAt ? (
                      <div>
                        <div className="text-[12px] text-ink-700">{formatRelative(lastSentAt)}</div>
                        <div className="text-[11px] text-ink-400">{sendCount}× total</div>
                      </div>
                    ) : (
                      <span className="text-[12px] text-ink-400">Never</span>
                    )}
                  </Td>
                  <Td>
                    {onCooldown ? (
                      <div>
                        <Pill tone="neutral">Cooldown</Pill>
                        <div className="mt-1 text-[11px] text-ink-400">due in {dueInH}h</div>
                      </div>
                    ) : (
                      <Pill tone="success">Due</Pill>
                    )}
                  </Td>
                  <Td>
                    <Button variant="secondary" size="sm" onClick={() => openPreview(row)}>
                      View email
                    </Button>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </TableShell>
      ) : null}

      {selected ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={closePreview}
        >
          <div
            className="relative w-full max-w-[720px] max-h-[92vh] overflow-auto rounded-[8px] border border-ink-100 bg-ink-0 p-6 shadow-[0_20px_40px_rgba(11,14,20,0.12)]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={closePreview}
              aria-label="Close"
              className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-900"
            >
              <X className="h-4 w-4" weight="regular" />
            </button>
            <h2 className="mb-1 text-[15px] font-semibold text-ink-900">Traveler dinner email preview</h2>
            <p className="mb-4 text-[12px] text-ink-500">
              To: {selected.email} · Subject: <span className="font-medium text-ink-700">{preview?.subject || "What's for dinner tonight?"}</span>
            </p>

            {previewLoading ? (
              <div className="flex justify-center py-16"><Loader /></div>
            ) : null}

            {previewError ? <Banner variant="danger" className="mb-4">{previewError}</Banner> : null}

            {preview ? (
              <>
                {!preview.eligible ? (
                  <div className="mb-3 rounded-[6px] bg-warn-weak px-3 py-2 text-[12px] text-warn">
                    Not currently eligible ({preview.reason}). Sending is blocked server-side.
                  </div>
                ) : null}

                {(preview.cards || []).length === 0 ? (
                  <div className="mb-3 rounded-[6px] bg-warn-weak px-3 py-2 text-[12px] text-warn">
                    No restaurants found for this location - the email would have no cards.
                  </div>
                ) : null}

                <div className="overflow-hidden rounded-[6px] border border-ink-100">
                  <iframe srcDoc={preview.html} title="Email Preview" className="h-[520px] w-full border-0" />
                </div>

                {/* Send history for this person */}
                <div className="mt-4">
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-micro text-ink-500">
                    Send history {preview.sendCount ? `(${preview.sendCount})` : ''}
                  </div>
                  {(preview.history || []).length > 0 ? (
                    <ul className="flex flex-col gap-1">
                      {[...preview.history].reverse().map((h, i) => (
                        <li key={i} className="flex items-center justify-between rounded-[6px] bg-ink-50 px-3 py-1.5 text-[12px]">
                          <span className="text-ink-700">{formatWhen(h.sentAt)}</span>
                          <span className="text-ink-400">
                            {h.channel === 'admin' ? `manual${h.sentBy ? ` · ${h.sentBy}` : ''}` : 'cron'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[12px] text-ink-400">Never emailed yet.</p>
                  )}
                </div>

                {/* Send - two-stage confirm */}
                <div className="mt-4 flex flex-col gap-3 rounded-[6px] border border-ink-100 bg-ink-50 p-3">
                  {sendResult ? (
                    <div className={'flex items-start gap-2 rounded-[6px] px-3 py-2 text-[13px] ' + (sendResult.success ? 'bg-success-weak text-success' : 'bg-danger-weak text-danger')}>
                      {sendResult.success ? <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" weight="regular" /> : null}
                      <span>{sendResult.message}</span>
                    </div>
                  ) : null}

                  {testResult ? (
                    <div className={'flex items-start gap-2 rounded-[6px] px-3 py-2 text-[13px] ' + (testResult.success ? 'bg-success-weak text-success' : 'bg-danger-weak text-danger')}>
                      {testResult.success ? <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" weight="regular" /> : null}
                      <span>{testResult.message}</span>
                    </div>
                  ) : null}

                  {sentKeys[rowKey(selected)] ? (
                    <div className="rounded-[6px] bg-success-weak px-3 py-2 text-[12px] text-success">
                      Sent this session on {formatWhen(sentKeys[rowKey(selected)])}. Next send allowed after the 2-day cooldown.
                    </div>
                  ) : !preview.canSendNow && preview.lastSentAt ? (
                    <div className="rounded-[6px] bg-warn-weak px-3 py-2 text-[12px] text-warn">
                      In cooldown - last sent {formatRelative(preview.lastSentAt)} (due in {hoursUntilDue(preview.lastSentAt)}h). Sending is blocked until then.
                    </div>
                  ) : null}

                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => handleSendTest(selected)}
                      disabled={testSending || batchSending || (preview.cards || []).length === 0}
                      className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-ink-200 bg-ink-0 px-3 text-[12px] font-medium text-ink-700 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <PaperPlaneTilt className="h-[13px] w-[13px]" weight="regular" />
                      {testSending ? 'Sending test…' : 'Send test to ath.sub.007@gmail.com'}
                    </button>
                    {confirmKey === rowKey(selected) ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmKey(null)}
                          disabled={sendingKey === rowKey(selected)}
                          className="inline-flex h-8 items-center rounded-[6px] border border-ink-200 bg-ink-0 px-3 text-[12px] font-medium text-ink-700 transition-colors hover:bg-ink-50 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSend(selected)}
                          disabled={sendingKey === rowKey(selected) || batchSending}
                          className="inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-ink-900 px-3 text-[12px] font-medium text-white transition-colors hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <PaperPlaneTilt className="h-[13px] w-[13px]" weight="regular" />
                          {sendingKey === rowKey(selected) ? 'Sending…' : `Click to confirm send to ${selected.email}`}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmKey(rowKey(selected))}
                        disabled={!preview.eligible || !preview.canSendNow || batchSending || Boolean(sentKeys[rowKey(selected)])}
                        className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-ink-200 bg-ink-0 px-3 text-[12px] font-medium text-ink-700 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <PaperPlaneTilt className="h-[13px] w-[13px]" weight="regular" />
                        Send dinner email
                      </button>
                    )}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}

export const getServerSideProps = withAuth();
