import { useState, useEffect } from 'react';
import { Button } from '@cloudflare/kumo';
import { Modal } from '../layout/Modal';
import { formatCurrentAddress, effectiveDeliverAt, effectiveDeliveryTiming, stripHandoffSuffix } from '../../lib/orderDelivery';
import { formatRecipientPhone } from '../../lib/phoneFormat';
const {
  MEAL_WINDOWS,
  getDateOptions,
  getSlotsForAnchor,
  getMealWindowsForAnchor,
  getSlotsForMealWindow,
  formatSlotLabel,
} = require('../../lib/scheduling');

// Ops can schedule up to 7 days out — broader than the customer-facing
// range, so ops can honour a verbal "next Friday" from a WhatsApp chat.
const OPS_MAX_OFFSET = 6;

const EMPTY_ADDRESS = {
  doorFlat: '', street: '', landmark: '', area: '', city: '', state: '', pincode: '',
};
const ADDRESS_FIELDS = ['doorFlat', 'street', 'landmark', 'area', 'city', 'state', 'pincode'];

// Unified "Confirm delivery details" modal — one form for delivery time
// + address with two save buttons. Shared by the dispatch page and the
// /orders page so both surfaces edit delivery details identically.
//
// Props:
//   order    — the order to edit (null when closed)
//   open     — whether the modal is shown
//   onClose  — called to dismiss
//   onSaved  — called after a successful save with
//              { orderId, confirmedAddress, scheduledFor, markAsConfirmed }
export function ConfirmDeliveryDetailsModal({ order, open, onClose, onSaved }) {
  const [anchor, setAnchor] = useState(null);
  const [mealWindow, setMealWindow] = useState('');
  const [slot, setSlot] = useState(null);
  const [asap, setAsap] = useState(false);
  const [address, setAddress] = useState(EMPTY_ADDRESS);
  const [submitting, setSubmitting] = useState(false);

  const mealWindowRequired = Boolean(
    order?.scheduling?.mealWindow ||
    order?.recipientContact?.confirmedMealWindow ||
    order?.recipientContact?.opsConfirmedMealWindow
  );
  const slotsFor = (anchorValue, mealWindowValue) => (
    mealWindowValue
      ? getSlotsForMealWindow(anchorValue, mealWindowValue, Date.now())
      : getSlotsForAnchor(anchorValue, Date.now())
  );

  // Pre-fill the form whenever the modal opens for an order.
  useEffect(() => {
    if (!open || !order) return;

    const timing = effectiveDeliveryTiming(order);
    const eff = effectiveDeliverAt(order);
    const dateOpts = getDateOptions(Date.now(), OPS_MAX_OFFSET);
    let nextAnchor =
      dateOpts.find((o) => o.label.startsWith('Tomorrow'))?.anchor || dateOpts[0]?.anchor;
    let nextSlot = null;
    let nextAsap = false;
    let nextMealWindow = timing.mode === 'scheduled' ? (timing.mealWindow || '') : '';
    if (eff === 'asap') {
      nextAsap = true;
    } else if (typeof eff === 'number') {
      for (const opt of dateOpts) {
        const slots = slotsFor(opt.anchor, nextMealWindow);
        if (slots.includes(eff)) {
          nextAnchor = opt.anchor;
          nextSlot = eff;
          break;
        }
      }
    }
    if (!nextSlot && nextAnchor) {
      if (nextMealWindow && !getSlotsForMealWindow(nextAnchor, nextMealWindow, Date.now()).length) {
        nextMealWindow = '';
      }
      nextSlot = slotsFor(nextAnchor, nextMealWindow)[0] || null;
    }
    setAnchor(nextAnchor || null);
    setMealWindow(nextMealWindow);
    setSlot(nextSlot);
    setAsap(nextAsap);

    const existing = order.recipientContact?.confirmedAddress;
    setAddress({
      // Strip the Slack handoff suffix so an ops re-save never persists
      // it into confirmedAddress (lib/orderDelivery.js stripHandoffSuffix).
      doorFlat: existing?.doorFlat || stripHandoffSuffix(order.recipient?.doorNo) || '',
      street: existing?.street || order.recipient?.addressLine || '',
      landmark: existing?.landmark || order.recipient?.landmark || '',
      area: existing?.area || '',
      city: existing?.city || '',
      state: existing?.state || '',
      pincode: existing?.pincode || '',
    });
    setSubmitting(false);
  }, [open, order]);

  // Submit — `markAsConfirmed` is the only difference between the two
  // save buttons. True flips recipientContact.status to 'confirmed';
  // false just persists field changes.
  const submit = async (markAsConfirmed) => {
    if (!order) return;

    // Warn before clearing a carefully-set scheduled slot for ASAP.
    const eff = effectiveDeliverAt(order);
    if (asap && typeof eff === 'number') {
      const ok = window.confirm(
        'Switching this order to ASAP?\n\nThis clears the currently-scheduled delivery time and marks the order for immediate dispatch.'
      );
      if (!ok) return;
    }

    setSubmitting(true);
    try {
      const scheduledFor = asap
        ? 'asap'
        : (typeof slot === 'number' ? slot : null);

      if (!asap && typeof scheduledFor === 'number' && mealWindowRequired && !mealWindow) {
        window.alert('Pick a meal window before saving this scheduled delivery time.');
        setSubmitting(false);
        return;
      }

      const payload = {
        userId: order.userId,
        orderId: order.id,
        address,
        markAsConfirmed: !!markAsConfirmed,
      };
      if (scheduledFor !== null) payload.scheduledFor = scheduledFor;
      if (scheduledFor !== null && scheduledFor !== 'asap' && mealWindow) {
        payload.mealWindow = mealWindow;
      }

      const resp = await fetch('/api/whatsapp/ops-confirm-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.error || `ops-confirm-details ${resp.status}`);
      }

      onSaved?.({
        orderId: order.id,
        confirmedAddress: address,
        scheduledFor,
        mealWindow: scheduledFor !== 'asap' ? (mealWindow || null) : null,
        markAsConfirmed: !!markAsConfirmed,
      });
      onClose?.();
    } catch (err) {
      console.error('Confirm details failed:', err);
      window.alert(`Could not save: ${err.message}`);
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Confirm delivery details" maxWidth="max-w-[560px]">
      {order ? (
        <>
          {/* Recipient header */}
          <div className="mb-3 rounded-[6px] bg-ink-50 px-3 py-2 text-[13px] text-ink-700">
            <div className="font-medium text-ink-900">{order.recipient?.name || 'N/A'}</div>
            <div className="text-ink-600">{formatRecipientPhone(order.recipient)}</div>
          </div>

          {/* Time section */}
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Delivery time</div>
          <div className="mb-2 flex items-center gap-2">
            <input
              id="confirm-asap-toggle"
              type="checkbox"
              checked={asap}
              onChange={(e) => setAsap(e.target.checked)}
              className="h-4 w-4 rounded border-ink-300 text-accent focus:ring-accent"
            />
            <label htmlFor="confirm-asap-toggle" className="text-[13px] text-ink-700 cursor-pointer">
              Deliver ASAP (no scheduled slot)
            </label>
          </div>
          <div className={`mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3 ${asap ? 'opacity-40 pointer-events-none' : ''}`}>
            <select
              value={anchor || ''}
              onChange={(e) => {
                const next = Number(e.target.value);
                setAnchor(next);
                const windowStillAvailable = mealWindow
                  ? getSlotsForMealWindow(next, mealWindow, Date.now()).length > 0
                  : true;
                const nextMealWindow = windowStillAvailable ? mealWindow : '';
                setMealWindow(nextMealWindow);
                const slots = slotsFor(next, nextMealWindow);
                setSlot(slots[0] || null);
              }}
              className="w-full rounded-[6px] border border-ink-200 bg-ink-0 px-3 py-2 text-[13px] text-ink-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              disabled={asap}
            >
              {getDateOptions(Date.now(), OPS_MAX_OFFSET).map((opt) => (
                <option key={opt.anchor} value={opt.anchor}>{opt.label}</option>
              ))}
            </select>
            <select
              value={mealWindow}
              onChange={(e) => {
                const nextMealWindow = e.target.value;
                setMealWindow(nextMealWindow);
                const slots = anchor ? slotsFor(anchor, nextMealWindow) : [];
                setSlot(slots[0] || null);
              }}
              className="w-full rounded-[6px] border border-ink-200 bg-ink-0 px-3 py-2 text-[13px] text-ink-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              disabled={asap}
            >
              <option value="" disabled={mealWindowRequired}>Meal window</option>
              {(anchor ? getMealWindowsForAnchor(anchor, Date.now()) : MEAL_WINDOWS).map((window) => (
                <option key={window.id} value={window.id}>
                  {window.label} ({window.displayRange})
                </option>
              ))}
            </select>
            <select
              value={slot || ''}
              onChange={(e) => setSlot(Number(e.target.value))}
              className="w-full rounded-[6px] border border-ink-200 bg-ink-0 px-3 py-2 text-[13px] text-ink-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              disabled={asap}
            >
              {(anchor ? slotsFor(anchor, mealWindow) : []).map((t) => (
                <option key={t} value={t}>{formatSlotLabel(t)}</option>
              ))}
            </select>
          </div>

          {/* Address section */}
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Address</div>
          {(() => {
            const { lines, source } = formatCurrentAddress(order);
            if (!lines.length) return null;
            const sourceLabel =
              source === 'ops_updated' ? 'Last saved by ops'
              : source === 'recipient_confirmed' ? 'Confirmed by recipient'
              : source === 'updated' ? 'Current address on file'
              : 'Sender entered';
            return (
              <div className="mb-3 rounded-[6px] border border-dashed border-ink-200 bg-ink-50/60 px-3 py-2">
                <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-500">{sourceLabel}</div>
                <div className="whitespace-pre-line text-[12.5px] text-ink-700">{lines.join('\n')}</div>
              </div>
            );
          })()}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {ADDRESS_FIELDS.map((field) => (
              <div key={field} className={field === 'street' || field === 'landmark' ? 'sm:col-span-2' : ''}>
                <label className="mb-1 block text-[12px] font-medium text-ink-700">
                  {field === 'doorFlat' ? 'Door / Flat' : field === 'street' ? 'Street / Address line' : field.charAt(0).toUpperCase() + field.slice(1)}
                </label>
                <input
                  type="text"
                  value={address[field]}
                  onChange={(e) => setAddress((p) => ({ ...p, [field]: e.target.value }))}
                  className="w-full rounded-[6px] border border-ink-200 bg-ink-0 px-3 py-2 text-[13px] text-ink-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>
            ))}
          </div>

          <div className="mt-4 mb-4 rounded-[6px] bg-success-weak px-3 py-2 text-[12px] text-success">
            Use <strong>Save &amp; confirm</strong> after you&apos;ve verified all details with {order.recipient?.name || 'the recipient'} on WhatsApp or by phone. Use <strong>Save changes</strong> for partial updates you&apos;re not ready to mark as confirmed yet.
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => submit(false)}
              disabled={submitting}
            >
              {submitting ? 'Saving…' : 'Save changes'}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => submit(true)}
              disabled={submitting}
            >
              {submitting ? 'Saving…' : 'Save & confirm'}
            </Button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
