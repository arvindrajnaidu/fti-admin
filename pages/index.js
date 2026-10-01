import { useEffect, useMemo, useState } from 'react';
import { formatOrderDistance } from '../lib/orderDistance';
import Head from 'next/head';
import NextLink from 'next/link';
import { Banner, Button, DatePicker, Loader } from '@cloudflare/kumo';
import { Truck, WhatsappLogo, Clock, Motorcycle } from '@phosphor-icons/react';
import { withAuth } from '../lib/withAuth';
import { AdminShell } from '../components/layout/AdminShell';
import { PageHeader } from '../components/layout/PageHeader';
import { TableShell, Th, Tr, Td, Pill, Dash, IconButton } from '../components/data/DataTable';
import { Modal } from '../components/layout/Modal';
import useIsMobile from '../lib/useIsMobile';
import { buildMessage, buildWaMeUrl } from '../lib/whatsappTemplates';
import { ConfirmDeliveryDetailsModal } from '../components/orders/ConfirmDeliveryDetailsModal';
import { InternalNotes } from '../components/orders/InternalNotes';
import { formatCurrentAddress, stripHandoffSuffix } from '../lib/orderDelivery';
import { MapsPreview } from '../components/orders/MapsPreview';
import { STANDARD_RANGES, isCustomRangeLabel, rangeQueryParams } from '../lib/dateRange';

const DEFAULT_RANGE = 'Last 7d';

const RANGE_DESCRIPTIONS = {
  'Last 3d': 'the last 3 days',
  'Last 7d': 'the last 7 days',
  '1 month': 'the last 30 days',
  '3 months': 'the last 90 days',
  'Last 1y': 'the last year',
  YTD: 'this year to date',
  Custom: 'the selected range',
};

const MEAL_WINDOW_LABELS = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  snack: 'Snack',
  dinner: 'Dinner',
};

// Times stored on orders.scheduling.scheduledFor are epoch ms representing
// IST wall-clock slots. We render them in IST regardless of the dispatcher's
// browser locale so what's on screen matches the customer-facing slot label.
const IST_TZ = 'Asia/Kolkata';
const HOUR_MS = 60 * 60 * 1000;

const formatIst = (ms) => {
  if (!ms) return '—';
  const d = new Date(ms);
  const date = d.toLocaleString('en-US', { timeZone: IST_TZ, weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleString('en-US', { timeZone: IST_TZ, hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time} IST`;
};

const formatIstWithMealWindow = (ms, mealWindow) => {
  const label = MEAL_WINDOW_LABELS[mealWindow];
  if (!label) return formatIst(ms);
  const d = new Date(ms);
  const date = d.toLocaleString('en-US', { timeZone: IST_TZ, weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleString('en-US', { timeZone: IST_TZ, hour: 'numeric', minute: '2-digit' });
  return `${label} (${date} · ${time} IST)`;
};

const formatCreated = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const FLAG_OFFSET = 0x1f1e6 - 'A'.charCodeAt(0);
const flagEmoji = (cc) => {
  if (!cc || cc.length !== 2) return '';
  const up = cc.toUpperCase();
  return String.fromCodePoint(up.charCodeAt(0) + FLAG_OFFSET, up.charCodeAt(1) + FLAG_OFFSET);
};

const formatRecipientPhone = (recipient) => {
  if (!recipient) return '';
  const e164 = recipient.recipientPhoneE164;
  const country = recipient.recipientPhoneCountry;
  const phoneText =
    e164 ||
    recipient.phone ||
    (recipient.recipientPhone ? `+91 ${recipient.recipientPhone}` : '');
  if (!phoneText) return '';
  const flag = country && country !== 'IN' ? `${flagEmoji(country)} ` : '';
  return `${flag}${phoneText}`;
};

const getRecipientCity = (order) => {
  const loc = order.recipient?.location;
  if (!loc) return '';
  if (loc.addressComponents?.length) {
    const get = (type) =>
      loc.addressComponents.find((x) => x.types?.includes(type))?.long_name || '';
    const city = get('locality') || get('administrative_area_level_2');
    if (city) return city;
  }
  if (loc.formattedAddress) {
    const cleaned = loc.formattedAddress.replace(/,\s*Landmark:.*$/i, '').trim();
    const parts = cleaned.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 3] || parts[parts.length - 2] || '';
  }
  return '';
};

const formatRelative = (deltaMs) => {
  const abs = Math.abs(deltaMs);
  const totalHours = Math.floor(abs / HOUR_MS);
  if (totalHours >= 24) {
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    if (hours === 0) return `${days}d`;
    return `${days}d ${hours}hrs`;
  }
  const minutes = Math.floor((abs % HOUR_MS) / 60000);
  if (totalHours === 0) return `${minutes}m`;
  if (minutes === 0) return `${totalHours}h`;
  return `${totalHours}h ${minutes}m`;
};

// "May 17" — just the date the order was placed, no time. Used on the
// dispatch card as a quick context for how long the order has been
// sitting (paired with the delivery time on the right).
const formatOrderedDate = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
  });
};

// "6hrs late" / "30m late" / "1hr late". For the parenthetical on
// overdue cards. Plural-aware. Skips the minutes portion at scale.
const formatLate = (deltaMs) => {
  const abs = Math.abs(deltaMs);
  const totalHours = Math.floor(abs / HOUR_MS);
  if (totalHours >= 1) {
    const days = Math.floor(totalHours / 24);
    if (days >= 1) return `${days}${days === 1 ? 'd' : 'd'} late`;
    return `${totalHours}${totalHours === 1 ? 'hr' : 'hrs'} late`;
  }
  const minutes = Math.max(1, Math.floor(abs / 60000));
  return `${minutes}m late`;
};

// "3hrs ago" / "15m ago" / "2d ago". For ASAP cards where the urgency
// signal is how long the order has been sitting unactioned.
const formatAge = (deltaMs) => {
  const abs = Math.abs(deltaMs);
  const totalHours = Math.floor(abs / HOUR_MS);
  if (totalHours >= 24) {
    const days = Math.floor(totalHours / 24);
    return `${days}d ago`;
  }
  if (totalHours >= 1) {
    return `${totalHours}${totalHours === 1 ? 'hr' : 'hrs'} ago`;
  }
  const minutes = Math.max(1, Math.floor(abs / 60000));
  return `${minutes}m ago`;
};

// Card header row — icon + main text + optional lateness suffix.
//   Overdue   → icon: bike   main: "Mon, May 18 · 1:00 PM IST"   late: "17hrs late"   tone: danger
//   ASAP      → icon: bike   main: "3hrs ago"                     late: null           tone: danger
//   Scheduled → icon: clock  main: "Tue, May 19 · 2:30 PM IST"   late: null           tone: neutral
//
// Bike icon signals "needs dispatch action"; clock signals "waiting".
const formatScheduleSummary = (sched, nowMs, createdAt) => {
  if (sched.mode === 'asap') {
    const age = nowMs - new Date(createdAt || nowMs).getTime();
    return { icon: 'bike', main: formatAge(age), late: null, tone: 'danger' };
  }
  const time = formatIstWithMealWindow(sched.scheduledFor, sched.mealWindow);
  const delta = sched.scheduledFor - nowMs;
  if (delta < 0) {
    return { icon: 'bike', main: time, late: formatLate(delta), tone: 'danger' };
  }
  return { icon: 'clock', main: time, late: null, tone: 'neutral' };
};

const getScheduling = (order) => {
  const s = order.scheduling;
  if (!s || s.mode !== 'scheduled' || !s.scheduledFor) {
    return { mode: 'asap', scheduledFor: null };
  }
  return { mode: 'scheduled', scheduledFor: s.scheduledFor, mealWindow: s.mealWindow || null };
};

// The order's *effective* deliver-at — what dispatch ops should actually
// see and act on. Precedence (highest first):
//   1. opsConfirmedTimeSlot   (ops set this manually from a WA chat)
//   2. confirmedTimeSlot      (recipient confirmed via the public page)
//   3. scheduling.scheduledFor (sender's original choice at checkout)
//
// Both opsConfirmedTimeSlot and confirmedTimeSlot can hold the literal
// string 'asap' (when the chosen mode is ASAP) or an epoch ms number.
const getEffectiveScheduling = (order) => {
  const c = order?.recipientContact;
  const pick = (val, mealWindow) => {
    if (val === 'asap') return { mode: 'asap', scheduledFor: null };
    if (typeof val === 'number') return { mode: 'scheduled', scheduledFor: val, mealWindow: mealWindow || null };
    return null;
  };
  return (
    pick(c?.opsConfirmedTimeSlot, c?.opsConfirmedMealWindow) ||
    pick(c?.confirmedTimeSlot, c?.confirmedMealWindow) ||
    getScheduling(order)
  );
};

const bucketize = (orders, nowMs) => {
  const overdue = [];
  const asap = [];
  const future = [];
  for (const o of orders) {
    const sched = getEffectiveScheduling(o);
    if (sched.mode === 'scheduled') {
      if (sched.scheduledFor < nowMs) overdue.push(o);
      else future.push(o);
    } else {
      asap.push(o);
    }
  }
  // Overdue: most overdue first (smallest scheduledFor first).
  overdue.sort(
    (a, b) =>
      getEffectiveScheduling(a).scheduledFor - getEffectiveScheduling(b).scheduledFor,
  );
  // ASAP: oldest placed first (FIFO).
  asap.sort(
    (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
  );
  // Future: soonest first.
  future.sort(
    (a, b) =>
      getEffectiveScheduling(a).scheduledFor - getEffectiveScheduling(b).scheduledFor,
  );
  return { overdue, asap, future };
};

export default function DispatchPage() {
  const isMobile = useIsMobile();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [environment, setEnvironment] = useState('dev');
  const [refreshing, setRefreshing] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [customRange, setCustomRange] = useState(null);
  const isCustom = isCustomRangeLabel(range);

  // Order-detail modal (in-place — no navigation to /orders).
  const [selectedOrder, setSelectedOrder] = useState(null);

  // Unified "Confirm delivery details" modal (shared extracted component).
  const [confirmOrder, setConfirmOrder] = useState(null);

  const openOrderModal = (order) => setSelectedOrder(order);
  const closeOrderModal = () => setSelectedOrder(null);

  // After the shared confirm modal saves — optimistically patch the open
  // order-detail modal, then refresh in the background.
  const handleConfirmSaved = ({ orderId, confirmedAddress, scheduledFor, mealWindow, markAsConfirmed }) => {
    if (selectedOrder?.id === orderId) {
      setSelectedOrder((prev) => {
        const nextRC = { ...(prev.recipientContact || {}) };
        nextRC.confirmedAddress = confirmedAddress;
        if (scheduledFor != null) {
          nextRC.opsConfirmedTimeSlot = scheduledFor;
          if (mealWindow) nextRC.opsConfirmedMealWindow = mealWindow;
          else delete nextRC.opsConfirmedMealWindow;
        }
        if (markAsConfirmed) nextRC.status = 'confirmed';
        return { ...prev, recipientContact: nextRC };
      });
    }
    fetchOrders(true);
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/environment');
        if (res.ok) setEnvironment((await res.json()).environment);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    // Wait for both ends of a custom range before firing a request.
    if (isCustom && (!customRange?.from || !customRange?.to)) return;
    fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, customRange]);

  // Tick every minute so overdue/relative labels stay live without a refetch.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  const fetchOrders = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const rq = rangeQueryParams(range, { custom: customRange });
      if (!rq) return;
      const params = new URLSearchParams({
        ...rq,
        status: 'pending',
        limit: '500',
        page: '1',
        ...(force ? { forceRefresh: 'true' } : {}),
      });
      const res = await fetch(`/api/orders?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Failed to load orders');
      }
      const data = await res.json();
      setOrders(data.orders || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchOrders(true);
    } finally {
      setRefreshing(false);
    }
  };

  const buckets = useMemo(() => bucketize(orders, nowMs), [orders, nowMs]);

  // Keep the open order-detail modal in sync with background refreshes.
  // After ops saves a change, fetchOrders(true) replaces the orders
  // array; without this effect, the modal would keep showing the stale
  // selectedOrder snapshot from before the save.
  useEffect(() => {
    if (!selectedOrder?.id) return;
    const fresh = orders.find((o) => o.id === selectedOrder.id);
    if (fresh && fresh !== selectedOrder) setSelectedOrder(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);

  return (
    <AdminShell environment={environment}>
      <Head>
        <title>FoodtoIndia Admin — Dispatch</title>
      </Head>

      <PageHeader
        icon={Truck}
        title="Dispatch queue"
        subtitle={`Pending orders from ${RANGE_DESCRIPTIONS[range]} · overdue first, then ASAP, then upcoming`}
        filters={{ options: STANDARD_RANGES, active: range, onChange: setRange }}
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
      />

      {error ? (
        <Banner variant="danger" className="mb-6">
          {error}
        </Banner>
      ) : null}

      {loading && orders.length === 0 ? (
        <div className="flex justify-center py-16">
          <Loader />
        </div>
      ) : null}

      {!loading || orders.length > 0 ? (
        <div className="flex flex-col gap-10">
          <BucketSection
            title="Overdue"
            tone="danger"
            orders={buckets.overdue}
            nowMs={nowMs}
            isMobile={isMobile}
            onOpen={openOrderModal}
            emptyMessage="Nothing overdue. Caught up."
          />
          <BucketSection
            title="ASAP"
            tone="warn"
            orders={buckets.asap}
            nowMs={nowMs}
            isMobile={isMobile}
            onOpen={openOrderModal}
            emptyMessage="No ASAP orders pending."
          />
          <BucketSection
            title="Scheduled"
            tone="neutral"
            orders={buckets.future}
            nowMs={nowMs}
            isMobile={isMobile}
            onOpen={openOrderModal}
            emptyMessage="No upcoming scheduled orders."
          />

          {orders.length === 0 && !loading ? (
            <p className="text-center text-[13px] text-ink-500 py-4">
              No pending orders in {RANGE_DESCRIPTIONS[range]}.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Compact order-detail modal — opens in-place on the dispatch
          page (no navigation to /orders). Shows the dispatch-relevant
          info and the two ops actions. Full editing flows
          (cancel / store credit / email) still live on /orders. */}
      <Modal
        open={!!selectedOrder}
        onClose={closeOrderModal}
        title="Order details"
        maxWidth="max-w-[560px]"
      >
        {selectedOrder ? (
          <OrderDetailContent
            order={selectedOrder}
            nowMs={nowMs}
            onConfirmDetails={() => setConfirmOrder(selectedOrder)}
            onSendWhatsApp={() => sendWhatsAppForOrder(selectedOrder)}
          />
        ) : null}
      </Modal>

      {/* Unified "Confirm delivery details" modal — shared component. */}
      <ConfirmDeliveryDetailsModal
        order={confirmOrder}
        open={!!confirmOrder}
        onClose={() => setConfirmOrder(null)}
        onSaved={handleConfirmSaved}
      />
    </AdminShell>
  );
}

function BucketSection({ title, tone, orders, nowMs, isMobile, onOpen, emptyMessage }) {
  const titleTone =
    tone === 'danger' ? 'text-danger'
    : tone === 'warn' ? 'text-warn'
    : 'text-ink-900';
  return (
    <section>
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className={`text-[15px] font-medium ${titleTone}`}>{title}</h2>
        <span className="font-num tnum text-[13px] text-ink-500">{orders.length}</span>
      </div>
      {orders.length === 0 ? (
        <div className="rounded-[8px] border border-dashed border-ink-200 bg-ink-50 px-4 py-5 text-center text-[13px] text-ink-500">
          {emptyMessage}
        </div>
      ) : isMobile ? (
        <div className="flex flex-col gap-2">
          {orders.map((o) => (
            <OrderCard key={o.id} order={o} sched={getEffectiveScheduling(o)} nowMs={nowMs} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <TableShell>
          <thead>
            <tr>
              <Th>Order</Th>
              <Th>Scheduled</Th>
              <Th>Sender</Th>
              <Th>Recipient</Th>
              <Th>City</Th>
              <Th>Restaurant</Th>
              <Th align="right">Items</Th>
              <Th align="right">Placed</Th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const sched = getEffectiveScheduling(o);
              const items = Object.keys(o.lineItems || {}).length;
              const phone = formatRecipientPhone(o.recipient);
              return (
                <Tr key={o.id}>
                  <Td>
                    <button
                      type="button"
                      onClick={() => onOpen(o)}
                      className="font-mono text-[13px] font-medium text-accent hover:underline"
                    >
                      {o.id.slice(0, 8)}
                    </button>
                  </Td>
                  <Td>
                    <ScheduleCell sched={sched} nowMs={nowMs} createdAt={o.createdAt} />
                  </Td>
                  <Td>
                    <div className="text-[13px] text-ink-900">{o.senderName || '—'}</div>
                    {o.senderEmail ? (
                      <div className="text-[11px] text-ink-500">{o.senderEmail}</div>
                    ) : null}
                  </Td>
                  <Td>
                    <div className="text-ink-900">{o.recipient?.name || <Dash />}</div>
                    {phone ? (
                      <div className="font-mono text-[11px] text-ink-500">{phone}</div>
                    ) : null}
                  </Td>
                  <Td>
                    {getRecipientCity(o) ? (
                      <Pill tone="accent">{getRecipientCity(o)}</Pill>
                    ) : (
                      <Dash />
                    )}
                  </Td>
                  <Td className="text-ink-700">{o.restaurantName || <Dash />}</Td>
                  <Td align="right" className="font-num tnum">{items}</Td>
                  <Td align="right" className="text-[12px] text-ink-500">
                    {formatCreated(o.createdAt)}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </TableShell>
      )}
    </section>
  );
}

function ScheduleCell({ sched, nowMs, createdAt }) {
  if (sched.mode === 'asap') {
    const ageMs = createdAt ? nowMs - new Date(createdAt).getTime() : 0;
    const tone = ageMs > 2 * HOUR_MS ? 'danger' : 'warn';
    return (
      <div className="flex flex-col gap-0.5">
        <Pill tone={tone}>ASAP</Pill>
        {ageMs > 0 ? (
          <span className="text-[11px] text-ink-500">placed {formatRelative(ageMs)} ago</span>
        ) : null}
      </div>
    );
  }
  const delta = sched.scheduledFor - nowMs;
  const overdue = delta < 0;
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`text-[13px] font-medium ${overdue ? 'text-danger' : 'text-ink-900'}`}>
        {formatIstWithMealWindow(sched.scheduledFor, sched.mealWindow)}
      </span>
      <span className={`text-[11px] ${overdue ? 'text-danger' : 'text-ink-500'}`}>
        {overdue ? `${formatRelative(delta)} overdue` : `in ${formatRelative(delta)}`}
      </span>
    </div>
  );
}

// Open WhatsApp deep link for a recipient. Opens a blank tab
// synchronously (so popup blockers stay quiet), then fills its URL once
// the server hands back the confirm token. Same shape as the handler
// in pages/orders.js; duplicated rather than extracted because the
// helper is short and only used in two places.
async function sendWhatsAppForOrder(order) {
  const phoneE164 = order?.recipient?.recipientPhoneE164;
  if (!phoneE164) {
    window.alert('No E.164 phone on file for this recipient — cannot send WhatsApp.');
    return;
  }
  const win = window.open('', '_blank');
  try {
    const resp = await fetch('/api/whatsapp/log-sent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: order.userId, orderId: order.id }),
    });
    if (!resp.ok) throw new Error(`log-sent ${resp.status}`);
    const { confirmationPageUrl } = await resp.json();
    const senderFirstName = (order.senderName || '').split(' ')[0] || 'Your friend';
    const r = order.recipient || {};
    const rDoorNo = stripHandoffSuffix(r.doorNo);
    const fullAddress = [rDoorNo, r.addressLine, r.landmark, r.location?.formattedAddress]
      .filter(Boolean).join('\n') || null;
    const hasFullAddress = !!(rDoorNo && r.addressLine);
    const timing = getEffectiveScheduling(order);
    const message = buildMessage({
      recipientName: r.name || 'there',
      senderFirstName,
      restaurantName: order.restaurantName || 'a restaurant',
      scheduledForMs: timing.mode === 'scheduled' ? timing.scheduledFor : null,
      mealWindow: timing.mode === 'scheduled' ? timing.mealWindow || null : null,
      fullAddress: hasFullAddress ? fullAddress : null,
      areaCity: hasFullAddress ? null : (r.location?.formattedAddress || ''),
      profileAddress: null,
      confirmationUrl: confirmationPageUrl,
    });
    if (win) win.location.href = buildWaMeUrl(phoneE164, message);
  } catch (err) {
    console.error('Send WhatsApp failed:', err);
    if (win) win.close();
    window.alert('Could not send WhatsApp — please try again.');
  }
}

// Dispatch order card. Final layout per spec:
//
//   Overdue     🚴  Mon, May 18 · 1:00 PM IST (17hrs late)
//   ASAP        🚴  3hrs ago
//   Scheduled   🕐  Mon, May 18 · 1:00 PM IST
//
//   David N   🇬🇧 +44 1615 114623                            [💬]
//   Bengaluru
//
//   The Blue Bawarchi Restaurant · 4 items
//   ─── soft hairline ───
//   Sender: Demo User · May 17
//
// Bike icon = needs dispatch action (overdue or ASAP, both red).
// Clock icon = waiting (scheduled future, neutral).
function OrderCard({ order, sched, nowMs, onOpen }) {
  const cleanName = (raw) =>
    (raw || '').replace(/\s*\[Risk Score:[^\]]*\]\s*$/, '').trim() || 'N/A';
  const senderName = cleanName(order.senderName);
  const recipientName = cleanName(order.recipient?.name);
  const phone = formatRecipientPhone(order.recipient);
  const city = getRecipientCity(order);
  const items = Object.keys(order.lineItems || {}).length;
  const phoneE164 = order.recipient?.recipientPhoneE164;
  const status = order.status || 'pending';
  const showWA = phoneE164 && status !== 'cancelled';

  const onWAClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    sendWhatsAppForOrder(order);
  };

  const summary = formatScheduleSummary(sched, nowMs, order.createdAt);
  const mainColor = summary.tone === 'danger' ? 'text-danger' : 'text-ink-900';
  const Icon = summary.icon === 'bike' ? Motorcycle : Clock;
  const iconColor = summary.tone === 'danger' ? 'text-danger' : 'text-ink-500';

  return (
    <button
      type="button"
      onClick={() => onOpen(order)}
      className="block w-full rounded-[12px] border border-ink-100 bg-ink-0 p-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-all hover:border-ink-200 hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)] active:bg-ink-50"
    >
      {/* Row 1: icon + time + (lateness) */}
      <div className="flex items-center gap-2">
        <Icon className={`h-[15px] w-[15px] shrink-0 ${iconColor}`} weight="regular" />
        <span className={`text-[14.5px] font-semibold leading-tight ${mainColor}`}>
          {summary.main}
          {summary.late ? (
            <span className="ml-1 text-[12px] font-medium text-danger">
              ({summary.late})
            </span>
          ) : null}
        </span>
      </div>

      {/* Recipient row: name + phone, WA pushed right */}
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[14.5px] font-medium text-ink-900">{recipientName}</span>
        {order.recipientContact?.status === 'confirmed' ? (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-success-weak px-1.5 py-0.5 text-[10.5px] font-semibold text-success">
            ✓ Confirmed
          </span>
        ) : null}
        {phone ? (
          <span className="font-mono text-[12.5px] text-ink-600">{phone}</span>
        ) : null}
        {showWA ? (
          <span
            role="button"
            tabIndex={-1}
            onClick={onWAClick}
            className="ml-auto inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-success-weak text-success transition-colors hover:bg-success hover:text-ink-0 active:bg-success active:text-ink-0"
            title="Send WhatsApp confirmation"
            aria-label="Send WhatsApp confirmation"
          >
            <WhatsappLogo className="h-5 w-5" weight="regular" />
          </span>
        ) : null}
      </div>
      {city ? (
        <div className="mt-0.5 text-[12px] text-ink-500">{city}</div>
      ) : null}

      {/* Restaurant + items */}
      <div className="mt-2.5 text-[13px] text-ink-700">
        {order.restaurantName || '—'}
        <span className="text-ink-300"> · </span>
        <span className="font-num tnum">{items} {items === 1 ? 'item' : 'items'}</span>
      </div>

      {/* Soft hairline divider */}
      <div className="my-2.5 border-t border-ink-100" />

      {/* Sender + date */}
      <div className="text-[11.5px] text-ink-500">
        Sender: <span className="text-ink-700">{senderName}</span>
        <span className="text-ink-300"> · </span>
        {formatOrderedDate(order.createdAt)}
      </div>
    </button>
  );
}

// Compact order-detail body rendered inside the dispatch-page modal.
// Slimmer than the /orders page's full modal: covers the dispatch ops
// flow (update time, update address, send WhatsApp) without the
// cancel/store-credit/email surface — those stay desktop-only via the
// /orders page where the founder manages them personally.
function OrderDetailContent({ order, nowMs, onConfirmDetails, onSendWhatsApp }) {
  const sched = getEffectiveScheduling(order);
  const summary = formatScheduleSummary(sched, nowMs, order.createdAt);
  const phone = formatRecipientPhone(order.recipient);
  const phoneE164 = order.recipient?.recipientPhoneE164;
  const items = Object.entries(order.lineItems || {});
  const status = order.status || 'pending';
  const cleanName = (raw) =>
    (raw || '').replace(/\s*\[Risk Score:[^\]]*\]\s*$/, '').trim() || 'N/A';
  const showWA = phoneE164 && status !== 'cancelled';
  const SummaryIcon = summary.icon === 'bike' ? Motorcycle : Clock;
  const summaryColor = summary.tone === 'danger' ? 'text-danger' : 'text-ink-900';

  return (
    <div className="space-y-4">
      {/* Header chips: status + delivery summary */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        <Pill tone={status === 'cancelled' ? 'danger' : status === 'dispatched' ? 'success' : 'warn'}>
          {status}
        </Pill>
        <span className="text-ink-500">
          Ordered: <span className="text-ink-700">{formatOrderedDate(order.createdAt)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <SummaryIcon className={`h-[14px] w-[14px] ${summary.tone === 'danger' ? 'text-danger' : 'text-ink-500'}`} weight="regular" />
          <span className={`font-medium ${summaryColor}`}>{summary.main}</span>
          {summary.late ? <span className="text-danger">({summary.late})</span> : null}
        </span>
      </div>

      {/* Action row — single primary action opens the unified modal
          where ops can edit both time and address and decide whether
          to flip the status to "confirmed". Send WhatsApp stays
          alongside as an independent comms action. */}
      {status !== 'cancelled' ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onConfirmDetails}
            className="inline-flex items-center gap-1.5 rounded-[8px] bg-success px-3 py-1.5 text-[13px] font-medium text-ink-0 shadow-sm transition-colors hover:bg-success-strong"
          >
            <Clock className="h-4 w-4" weight="bold" />
            Confirm delivery details
          </button>
          {showWA ? (
            <button
              type="button"
              onClick={onSendWhatsApp}
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-ink-200 bg-ink-0 px-3 py-1.5 text-[13px] font-medium text-ink-900 transition-colors hover:border-ink-300 hover:bg-ink-50"
              title="Send WhatsApp confirmation"
            >
              <WhatsappLogo className="h-4 w-4 text-success" weight="regular" />
              Send WhatsApp
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Recipient block — address reflects the latest confirmedAddress
          (ops or recipient) when present, falling back to the sender's
          original entry. */}
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Recipient</div>
        <div className="text-[14px] font-medium text-ink-900">{cleanName(order.recipient?.name)}</div>
        {phone ? <div className="font-mono text-[12px] text-ink-600">{phone}</div> : null}
        {(() => {
          const { lines, source } = formatCurrentAddress(order);
          if (!lines.length) return null;
          return (
            <>
              <div className="mt-1 whitespace-pre-line text-[12px] text-ink-600">
                {lines.join('\n')}
              </div>
              {source !== 'sender_entered' ? (
                <div className="mt-0.5 text-[10.5px] font-medium uppercase tracking-wider text-success">
                  {source === 'ops_updated' ? 'Updated by ops' : 'Confirmed by recipient'}
                </div>
              ) : null}
              {/* D11 (revised): inline map preview instead of external link.
                  Click "Show map" expands a Google Maps iframe in place,
                  keeping ops inside admin instead of deep-linking to their
                  personal Google Maps app on mobile. Silent when the order
                  has no usable pin coords. */}
              <MapsPreview order={order} />
            </>
          );
        })()}
      </div>

      {/* Sender block */}
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Sender</div>
        <div className="text-[14px] font-medium text-ink-900">{cleanName(order.senderName)}</div>
        {order.senderEmail ? <div className="text-[12px] text-ink-500">{order.senderEmail}</div> : null}
      </div>

      {/* Restaurant block */}
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Restaurant</div>
        <div className="text-[14px] font-medium text-ink-900">{order.restaurantName || '—'}</div>
        {order.restaurantCity ? (
          <div className="text-[12.5px] text-ink-600">{order.restaurantCity}</div>
        ) : null}
        {formatOrderDistance(order) ? (
          <div className="text-[12.5px] text-ink-600">{formatOrderDistance(order)}</div>
        ) : null}
      </div>

      {/* Items list (compact) */}
      {items.length > 0 ? (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            Items ({items.length})
          </div>
          <ul className="space-y-0.5 text-[13px] text-ink-700">
            {items.map(([id, it]) => (
              <li key={id} className="flex justify-between gap-2">
                <span>{(it?.name || '').split('\n')[0] || 'Item'}</span>
                <span className="font-num tnum text-ink-500">× {it?.quantity || 1}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Note to restaurant — sender's special instructions */}
      {order.notes ? (
        <div className="rounded-[6px] bg-warn-weak px-3 py-2 text-[12px] text-warn">
          <strong className="mr-1">Note to restaurant, from sender:</strong>{order.notes}
        </div>
      ) : null}

      {/* Internal notes + audit trail (ops-only) */}
      <InternalNotes key={order.id} userId={order.userId} orderId={order.id} />

      {/* Footer link — for the full editing surface (cancel, store credit, email) */}
      <div className="border-t border-ink-100 pt-3 text-[12px] text-ink-500">
        Need more options?{' '}
        <NextLink href={`/orders?openOrder=${encodeURIComponent(order.id)}`} className="text-accent hover:underline">
          Open full order view
        </NextLink>
      </div>
    </div>
  );
}

export const getServerSideProps = withAuth();
