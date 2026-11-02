import { useState } from 'react';
import { Motorcycle } from '@phosphor-icons/react';

// "Submit link" on the order-detail modal: the admin equivalent of the Slack
// message shortcut. Posts to /api/dispatch-order, which runs foodtoindia's
// markDispatched (email, recipient WhatsApp, app push, Slack thread post).
// Shown on mobile too: ops submits links from their phones.
export function TrackingLinkForm({ order, onDispatched }) {
  const current = order.tracking_link || '';
  const [link, setLink] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    const value = link.trim();
    if (!value) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch('/api/dispatch-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: order.userId, orderId: order.id, trackingLink: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ success: false, message: data.error || 'Failed to submit tracking link' });
        return;
      }
      if (data.alreadyDispatched) {
        setResult({ success: true, message: 'This link was already submitted. Nothing re-sent.' });
      } else {
        const sent = [
          data.emailSent && 'email sent',
          data.whatsapp === 'sent' && 'WhatsApp sent',
          data.slackPosted && 'posted to Slack',
        ].filter(Boolean);
        setResult({
          success: true,
          message: `Marked dispatched${sent.length ? `: ${sent.join(', ')}` : ''}.` +
            (data.replacedPreviousLink ? ' The customer now has two tracking links.' : ''),
        });
      }
      setLink('');
      onDispatched?.(data.trackingLink);
    } catch (err) {
      setResult({ success: false, message: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mb-5 rounded-[10px] border border-ink-200 bg-ink-0 p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-micro text-ink-500">
        <Motorcycle className="h-3.5 w-3.5" weight="regular" />
        Tracking link
      </div>
      {current ? (
        <div className="mb-2 break-all text-[12.5px] text-ink-700">
          Current:{' '}
          <a href={current} target="_blank" rel="noopener noreferrer" className="text-accent underline">
            {current}
          </a>
        </div>
      ) : null}
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <input
          type="url"
          inputMode="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder={current ? 'Paste a corrected link' : 'Paste the Swiggy tracking link'}
          disabled={submitting}
          className="min-w-0 flex-1 rounded-[8px] border border-ink-200 bg-ink-0 px-3 py-1.5 text-[13px] text-ink-900 outline-none focus:border-ink-400"
        />
        <button
          type="submit"
          disabled={submitting || !link.trim()}
          className="inline-flex items-center justify-center gap-1.5 rounded-[8px] bg-success px-3 py-1.5 text-[13px] font-medium text-ink-0 shadow-sm transition-colors hover:bg-success-strong disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : current ? 'Update link' : 'Submit link'}
        </button>
      </form>
      {result ? (
        <div className={`mt-2 text-[12.5px] ${result.success ? 'text-success' : 'text-danger'}`}>
          {result.message}
        </div>
      ) : null}
    </div>
  );
}
