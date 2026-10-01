import { useEffect, useState } from 'react';
import Head from 'next/head';
import { Banner, Button, Loader } from '@cloudflare/kumo';
import { X, PaperPlaneTilt, CheckCircle } from '@phosphor-icons/react';
import { withAuth } from '../lib/withAuth';
import { ShoppingCartSimple } from '@phosphor-icons/react';
import { toTitleCase } from '../lib/titleCase';
import {
  ABANDONED_CART_SUBJECTS,
  DEFAULT_SUBJECT_KEY,
  renderSubject,
  resolveRecipientName,
} from '../lib/abandonedCartSubjects';
import { AdminShell } from '../components/layout/AdminShell';
import { PageHeader } from '../components/layout/PageHeader';
import { StatCard } from '../components/data/StatCard';
import { TableShell, Th, Tr, Td, Pill } from '../components/data/DataTable';

const formatCurrency = (amount) => {
  // cartTotal arrives from the API already in USD (see lib/currency.js).
  return `$${Number(amount || 0).toFixed(2)}`;
};

const formatDate = (iso) => {
  if (!iso) return 'N/A';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatRelativeTime = (iso) => {
  if (!iso) return 'N/A';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(diff / 3600000);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
};

function buildEmailPreview(cart) {
  if (!cart) return '';
  const cartSummary =
    cart.itemCount > 0 ? `${cart.itemCount} items • ${formatCurrency(cart.cartTotal)}` : 'items';
  const itemNames = (cart.cartItemNames || []).slice(0, 3);
  const extra = Math.max((cart.itemCount || 0) - itemNames.length, 0);
  const cartItemSummary =
    itemNames.length > 0
      ? `${itemNames.join(' , ')}${extra > 0 ? ` and ${extra} more items` : ''}`
      : '';
  const checkoutUrl = 'https://foodtoindia.com/orders/create';
  const senderName = toTitleCase(cart.name) || 'there';
  const recipientName = resolveRecipientName({ raw: cart.recipientName, senderName });
  const restaurantName = cart.restaurantName || 'the restaurant';
  const bodyLine = recipientName
    ? `You left something in your cart! Complete your order for <strong>${recipientName}</strong> from <strong>${restaurantName}</strong>.`
    : `You left something in your cart from <strong>${restaurantName}</strong>. It's still waiting for you.`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><link href="https://fonts.googleapis.com/css2?family=Sanchez:wght@400;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"></head><body style="margin:0;padding:0;font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;background:#faf1e5;-webkit-font-smoothing:antialiased;"><div style="max-width:440px;margin:0 auto;padding:20px;"><div style="background:#fff;border-radius:12px;box-shadow:0 2px 20px rgba(0,0,0,0.07);overflow:hidden;"><div style="padding:16px 20px;text-align:center;border-bottom:3px solid #117150;"><div style="font-family:'Sanchez',serif;font-size:18px;font-weight:700;color:#117150;">FoodtoIndia</div></div><div style="padding:24px;"><h2 style="font-size:18px;font-weight:600;margin:0 0 8px 0;color:#2D2A26;">Hi ${senderName},</h2><p style="font-size:14px;line-height:1.6;color:#444;margin:0 0 20px 0;">${bodyLine}</p><div style="background:#faf8f5;border-radius:8px;padding:16px;margin:16px 0 20px;"><div style="font-size:13px;color:#8A8279;margin-bottom:6px;">YOUR CART</div><div style="font-size:14px;color:#2D2A26;line-height:1.5;margin-bottom:4px;">${cartSummary}</div><div style="font-size:13px;color:#6b655d;line-height:1.5;">${cartItemSummary}</div></div><div style="text-align:center;margin:28px 0;"><a href="${checkoutUrl}" style="display:inline-block;padding:14px 40px;background-color:#117150;color:#ffffff;text-decoration:none;border-radius:9999px;font-weight:700;font-size:15px;letter-spacing:0.01em;">Complete My Order</a></div><p style="font-size:13px;color:#8A8279;line-height:1.5;margin:20px 0 0;text-align:center;">Same-day delivery in 500+ cities • Pay in USD • Payments secured by Stripe</p></div><div style="padding:20px;text-align:center;font-size:12px;color:#aaa;border-top:1px solid #f0f0f0;">Follow us on Instagram: <a href="https://www.instagram.com/food2india" style="color:#667085;text-decoration:none;font-weight:500;">@food2india</a><br><a href="https://www.foodtoindia.com" style="color:#667085;text-decoration:none;">foodtoindia.com</a></div></div></div></body></html>`;
}

export default function AbandonedCartsPage() {
  const [carts, setCarts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [environment, setEnvironment] = useState('dev');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCart, setSelectedCart] = useState(null);
  // Send-reminder state. confirmId = id of cart awaiting confirmation
  // (null = button shows "Send reminder"; truthy = "Click to confirm").
  const [confirmId, setConfirmId] = useState(null);
  const [sendingId, setSendingId] = useState(null);
  const [sendResult, setSendResult] = useState(null);
  const [subjectKey, setSubjectKey] = useState(DEFAULT_SUBJECT_KEY);
  const [showConverted, setShowConverted] = useState(false);

  useEffect(() => {
    fetchCarts();
    fetch('/api/environment')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setEnvironment(d.environment))
      .catch(() => {});
  }, []);

  const fetchCarts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/abandoned-carts');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || 'Failed to fetch abandoned carts');
      }
      const data = await res.json();
      setCarts(data.carts || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchCarts();
    } finally {
      setRefreshing(false);
    }
  };

  const openPreview = (cart) => {
    setSelectedCart(cart);
    setConfirmId(null);
    setSendResult(null);
    setSubjectKey(DEFAULT_SUBJECT_KEY);
  };

  const closePreview = () => {
    setSelectedCart(null);
    setConfirmId(null);
    setSendResult(null);
  };

  const handleSendReminder = async (cart) => {
    setSendingId(cart.id);
    setSendResult(null);
    try {
      const res = await fetch('/api/abandoned-carts/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkoutId: cart.id, subjectKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || data.message || 'Failed to send reminder');
      }
      setSendResult({
        success: true,
        message: `Sent to ${data.sentTo} — "${data.subject}"`,
      });
      // Reflect the new reminderSent state locally so the UI + stats update
      setCarts((prev) =>
        prev.map((c) =>
          c.id === cart.id
            ? { ...c, reminderSent: true, reminderSentAt: data.sentAt }
            : c,
        ),
      );
      setConfirmId(null);
    } catch (err) {
      setSendResult({ success: false, message: err.message });
    } finally {
      setSendingId(null);
    }
  };

  // Default view: still-pending carts that haven't converted. Toggle expands
  // the list to also include converted carts so admins can audit which carts
  // recovered (and which contributed to the "Converted (after reminder)" stat).
  const activeCarts = carts.filter((c) => {
    if (c.status === 'pending' && !c.converted) return true;
    if (showConverted && c.converted) return true;
    return false;
  });
  const totalCarts = activeCarts.length;
  const convertedCount = carts.filter((c) => c.converted).length;
  const remindersSent = carts.filter((c) => c.reminderSent).length;
  const convertedAfterReminder = carts.filter((c) => c.convertedAfterReminder).length;
  const conversionRate =
    remindersSent > 0 ? ((convertedAfterReminder / remindersSent) * 100).toFixed(1) : '0';
  const recoveredValue = carts
    .filter((c) => c.convertedAfterReminder)
    .reduce((sum, c) => sum + (c.cartTotal || 0), 0);

  return (
    <AdminShell environment={environment}>
      <Head>
        <title>FoodtoIndia Admin — Abandoned Carts</title>
      </Head>

      <PageHeader
        icon={ShoppingCartSimple}
        title="Abandoned Carts"
        subtitle="Carts created in the last 30 days that weren't completed"
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

      <div className="mb-8 grid grid-cols-2 gap-x-8 gap-y-6 md:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Total abandoned" value={totalCarts.toString()} />
        <StatCard label="Reminders sent" value={remindersSent.toString()} />
        <StatCard
          label="Converted"
          value={convertedAfterReminder.toString()}
          subtext="after reminder"
        />
        <StatCard
          label="Conversion rate"
          value={`${conversionRate}%`}
          subtext="from reminders"
        />
        <StatCard
          label="Recovered value"
          value={formatCurrency(recoveredValue)}
          subtext="from reminders"
        />
      </div>

      {convertedCount > 0 ? (
        <div className="mb-4 flex items-center gap-2">
          <input
            type="checkbox"
            id="show-converted"
            checked={showConverted}
            onChange={(e) => setShowConverted(e.target.checked)}
            className="h-4 w-4 cursor-pointer rounded border-ink-200 text-accent focus:ring-accent"
          />
          <label htmlFor="show-converted" className="cursor-pointer text-[13px] text-ink-700">
            Show converted carts ({convertedCount})
          </label>
        </div>
      ) : null}

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

      {!loading && !error && activeCarts.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-[13px] text-ink-500">No active abandoned carts</p>
        </div>
      ) : null}

      {!loading && !error && activeCarts.length > 0 ? (
        <>
          {/* Desktop table */}
          <div className="hidden md:block">
            <TableShell>
              <thead>
                <tr>
                  <Th>Created</Th>
                  <Th>Customer</Th>
                  <Th>Recipient</Th>
                  <Th>Restaurant</Th>
                  <Th align="right">Items</Th>
                  <Th align="right">Total</Th>
                  <Th>Reminder</Th>
                  <Th>Converted</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {activeCarts.map((cart) => (
                  <Tr key={cart.id}>
                    <Td>
                      <div>{formatDate(cart.createdAt)}</div>
                      <div className="text-[11px] text-ink-400">
                        {formatRelativeTime(cart.createdAt)}
                      </div>
                    </Td>
                    <Td>
                      <div className="font-medium">{toTitleCase(cart.name)}</div>
                      <div className="text-[12px] text-ink-500">{cart.email}</div>
                    </Td>
                    <Td>{toTitleCase(cart.recipientName)}</Td>
                    <Td className="text-ink-600">{cart.restaurantName}</Td>
                    <Td align="right" className="font-num">{cart.itemCount}</Td>
                    <Td align="right" className="font-num font-medium">{formatCurrency(cart.cartTotal)}</Td>
                    <Td>
                      {cart.reminderSent ? (
                        cart.reminderSkippedReason ? (
                          <div>
                            <Pill tone="neutral">Skipped</Pill>
                            <div className="mt-1 text-[11px] text-ink-400">
                              {cart.reminderSkippedReason}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <Pill tone="success">Sent</Pill>
                            <div className="mt-1 text-[11px] text-ink-400">
                              {formatDate(cart.reminderSentAt)}
                            </div>
                          </div>
                        )
                      ) : (
                        <Pill tone="warn">Pending</Pill>
                      )}
                    </Td>
                    <Td>
                      {cart.converted ? (
                        <div>
                          <Pill tone="success">Yes</Pill>
                          {cart.convertedAfterReminder ? (
                            <div className="mt-1 text-[11px] font-medium text-success">
                              After reminder
                            </div>
                          ) : null}
                          <div className="mt-1 text-[11px] text-ink-400">
                            {formatDate(cart.convertedAt)}
                          </div>
                        </div>
                      ) : (
                        <Pill tone="danger">No</Pill>
                      )}
                    </Td>
                    <Td>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => openPreview(cart)}
                      >
                        View email
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableShell>
          </div>

          {/* Mobile card list */}
          <div className="flex flex-col gap-2 md:hidden">
            {activeCarts.map((cart) => (
              <div
                key={cart.id}
                className="rounded-[8px] border border-ink-100 bg-ink-0 p-3"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-ink-400">
                    {formatRelativeTime(cart.createdAt)}
                  </span>
                  <div className="flex flex-wrap justify-end gap-1">
                    {cart.reminderSent ? (
                      cart.reminderSkippedReason ? (
                        <Pill tone="neutral">Skipped</Pill>
                      ) : (
                        <Pill tone="success">Sent</Pill>
                      )
                    ) : (
                      <Pill tone="warn">Pending</Pill>
                    )}
                    {cart.converted ? (
                      <Pill tone="success">
                        {cart.convertedAfterReminder ? 'Converted (reminder)' : 'Converted'}
                      </Pill>
                    ) : (
                      <Pill tone="danger">No</Pill>
                    )}
                  </div>
                </div>
                <div className="mb-1 text-[13px] text-ink-900">
                  <span className="font-medium">{toTitleCase(cart.name)}</span>
                  <span className="text-ink-400"> → </span>
                  <span>{toTitleCase(cart.recipientName)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-[12px] text-ink-500">
                  <span>
                    {cart.restaurantName} · {cart.itemCount} items ·{' '}
                    <span className="font-num font-medium text-ink-900">
                      {formatCurrency(cart.cartTotal)}
                    </span>
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openPreview(cart)}
                  >
                    Email
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {selectedCart ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => closePreview()}
        >
          <div
            className="relative w-full max-w-[640px] max-h-[90vh] overflow-auto rounded-[8px] border border-ink-100 bg-ink-0 p-6 shadow-[0_20px_40px_rgba(11,14,20,0.12)]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => closePreview()}
              aria-label="Close"
              className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-900"
            >
              <X className="h-4 w-4" weight="regular" />
            </button>
            <h2 className="mb-1 text-[15px] font-semibold text-ink-900">
              Abandoned cart email preview
            </h2>
            <p className="mb-4 text-[12px] text-ink-500">
              To: {selectedCart.email} · Subject:{' '}
              <span className="font-medium text-ink-700">
                {renderSubject(subjectKey, {
                  recipient: resolveRecipientName({
                    raw: selectedCart.recipientName,
                    senderName: toTitleCase(selectedCart.name),
                  }),
                  restaurant: selectedCart.restaurantName,
                })}
              </span>
            </p>
            <div className="overflow-hidden rounded-[6px] border border-ink-100">
              <iframe
                srcDoc={buildEmailPreview(selectedCart)}
                title="Email Preview"
                className="h-[500px] w-full border-0"
              />
            </div>

            {/* Subject picker */}
            <div className="mt-4">
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-micro text-ink-500">
                Subject line
              </label>
              <select
                value={subjectKey}
                onChange={(e) => setSubjectKey(e.target.value)}
                disabled={sendingId === selectedCart.id}
                className="h-9 w-full rounded-[6px] border border-ink-200 bg-ink-0 px-3 text-[13px] text-ink-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
              >
                {ABANDONED_CART_SUBJECTS.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {renderSubject(opt.key, {
                      recipient: resolveRecipientName({
                        raw: selectedCart.recipientName,
                        senderName: toTitleCase(selectedCart.name),
                      }),
                      restaurant: selectedCart.restaurantName,
                    })}
                  </option>
                ))}
              </select>
            </div>

            {/* Send reminder — two-stage confirm */}
            <div className="mt-4 flex flex-col gap-3 rounded-[6px] border border-ink-100 bg-ink-50 p-3">
              {sendResult ? (
                <div
                  className={
                    'flex items-start gap-2 rounded-[6px] px-3 py-2 text-[13px] ' +
                    (sendResult.success
                      ? 'bg-success-weak text-success'
                      : 'bg-danger-weak text-danger')
                  }
                >
                  {sendResult.success ? (
                    <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" weight="regular" />
                  ) : null}
                  <span>{sendResult.message}</span>
                </div>
              ) : null}

              {selectedCart.reminderSent && !sendResult?.success ? (
                <div className="rounded-[6px] bg-warn-weak px-3 py-2 text-[12px] text-warn">
                  Reminder already sent {selectedCart.reminderSentAt ? `on ${formatDate(selectedCart.reminderSentAt)}` : ''}. Sending again will mark another send.
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] text-ink-500">
                  Sends the same template the cron will send.
                </div>
                {confirmId === selectedCart.id ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      disabled={sendingId === selectedCart.id}
                      className="inline-flex h-8 items-center rounded-[6px] border border-ink-200 bg-ink-0 px-3 text-[12px] font-medium text-ink-700 transition-colors hover:bg-ink-50 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSendReminder(selectedCart)}
                      disabled={sendingId === selectedCart.id}
                      className="inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-ink-900 px-3 text-[12px] font-medium text-white transition-colors hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <PaperPlaneTilt className="h-[13px] w-[13px]" weight="regular" />
                      {sendingId === selectedCart.id
                        ? 'Sending…'
                        : `Click to confirm send to ${selectedCart.email}`}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmId(selectedCart.id)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-ink-200 bg-ink-0 px-3 text-[12px] font-medium text-ink-700 transition-colors hover:bg-ink-50"
                  >
                    <PaperPlaneTilt className="h-[13px] w-[13px]" weight="regular" />
                    Send reminder email
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}

export const getServerSideProps = withAuth();
