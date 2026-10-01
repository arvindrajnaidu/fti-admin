// Eligibility + candidate selection for the traveler dinner-recommendation email.
//
// Self-contained in the admin app (mirrors the abandoned-carts model): the admin
// owns the whole feature and runs these queries against its OWN prod Firestore.
// The db handle is passed in (not imported) so this stays testable via node --test.
//
// Cohort:
//   - customer's MOST RECENT order is a traveler/self order
//     (order_intent === 'self_visiting' || recipient.recipientRole === 'traveler')
//   - delivered/dispatched (status 'dispatched' or dispatchedAt set), NOT pending,
//     NOT cancelled (there is no 'refunded' order status in the model)
//   - placed within the last 15 days
//   - has usable delivery lat/lng (recipient.location.lat/lng)
//   - sender has an email, is not unsubscribed
// Cadence: re-sendable every COOLDOWN_DAYS (default 2). Each send is appended to
// a history log on the user doc so the admin can show when they were last emailed.

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_MIN_DAYS = 0;
const DEFAULT_WINDOW_MAX_DAYS = 15;
const DEFAULT_COOLDOWN_DAYS = 2;
const HISTORY_CAP = 25;

const LIFECYCLE_KEY = 'travelerDinnerRecommendation';

// Ground-truth self/traveler detector (mirror of foodtoindia lib/title-case
// isSelfOrder). Inlined here because the two repos can't share code.
function isSelfOrder(order) {
  return order?.order_intent === 'self_visiting'
    || order?.recipient?.recipientRole === 'traveler';
}

// order.senderName carries a " [Risk Score: N, Country XX]" suffix since
// ~May 2026 (ops fraud signal). Strip it before any copy use, or a user with
// no displayName gets greeted as "[risk". Documented project-wide gotcha.
function cleanSenderName(raw) {
  return String(raw || '').replace(/\s*\[risk score:.*$/i, '').trim();
}

function getOrderLatLng(order) {
  const loc = order?.recipient?.location;
  const lat = Number(loc?.lat);
  const lng = Number(loc?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

function orderIsDispatched(order) {
  if (!order) return false;
  if (order.status === 'cancelled') return false;
  return order.status === 'dispatched' || Boolean(order.dispatchedAt);
}

function travelerDinnerMarker(user) {
  return user?.lifecycleEmails?.[LIFECYCLE_KEY] || null;
}

function lastSentAt(user) {
  const m = travelerDinnerMarker(user);
  if (!m) return null;
  return m.lastSentAt || m.sentAt || null;
}

function sendCount(user) {
  const m = travelerDinnerMarker(user);
  if (!m) return 0;
  if (Array.isArray(m.history)) return m.history.length;
  return m.sent ? 1 : 0;
}

function sendHistory(user) {
  const m = travelerDinnerMarker(user);
  return Array.isArray(m?.history) ? m.history : [];
}

function cooldownActive(user, now, cooldownDays = DEFAULT_COOLDOWN_DAYS) {
  const ls = lastSentAt(user);
  if (!ls) return false;
  return now - ls < cooldownDays * DAY_MS;
}

function evaluateCandidate({
  user,
  order,
  orderId,
  now,
  requireDispatched = true,
  windowMinDays = DEFAULT_WINDOW_MIN_DAYS,
  windowMaxDays = DEFAULT_WINDOW_MAX_DAYS,
  cooldownDays = DEFAULT_COOLDOWN_DAYS,
}) {
  const base = {
    eligible: false,
    canSendNow: false,
    cooldownActive: cooldownActive(user, now, cooldownDays),
    lastSentAt: lastSentAt(user),
    sendCount: sendCount(user),
  };

  if (!order) return { ...base, reason: 'no order doc' };
  if (!isSelfOrder(order)) return { ...base, reason: 'not a traveler order' };
  if (order.status === 'cancelled') return { ...base, reason: 'cancelled order' };
  if (requireDispatched && !orderIsDispatched(order)) {
    return { ...base, reason: 'not dispatched (pending)' };
  }

  const placedAt = Number(order.createdAt);
  if (!Number.isFinite(placedAt)) return { ...base, reason: 'no createdAt' };
  const ageDays = (now - placedAt) / DAY_MS;
  if (ageDays < windowMinDays) return { ...base, reason: 'too recent (<window)' };
  if (ageDays > windowMaxDays) return { ...base, reason: 'too old (>window)' };

  const latLng = getOrderLatLng(order);
  if (!latLng) return { ...base, reason: 'no usable lat/lng' };

  // Guest-checkout travelers keep their email under guestContact (top-level
  // users.email is deliberately never set for guests). Product decision
  // 2026-07-24: include them - the traveler/self segment IS largely the
  // guest-checkout population. `isGuest` is surfaced so the admin can see
  // which rows go to an unverified guest address.
  const email = user?.email || user?.guestContact?.email;
  if (!email) return { ...base, reason: 'no sender email' };
  if (user?.emailPreferences?.unsubscribed) return { ...base, reason: 'unsubscribed' };

  return {
    ...base,
    eligible: true,
    canSendNow: !base.cooldownActive,
    email,
    isGuest: !user?.email,
    senderName: user.displayName || user.name || user.guestContact?.name || cleanSenderName(order.senderName),
    lat: latLng.lat,
    lng: latLng.lng,
    city: order.restaurantCity || order.restaurantLocality || null,
    placedAt,
  };
}

/**
 * Scan users whose latest order fell in the last `windowMaxDays` and return the
 * traveler-dinner cohort (hard-eligible), each annotated with cooldown/history.
 * Runs against the admin app's own (prod) Firestore.
 */
async function findTravelerDinnerCandidates({
  db,
  now,
  requireDispatched = true,
  windowMinDays = DEFAULT_WINDOW_MIN_DAYS,
  windowMaxDays = DEFAULT_WINDOW_MAX_DAYS,
  cooldownDays = DEFAULT_COOLDOWN_DAYS,
}) {
  const windowStart = now - windowMaxDays * DAY_MS;
  const windowEnd = now - windowMinDays * DAY_MS;

  const usersSnap = await db
    .collection('users')
    .where('lastOrderAt', '>=', windowStart)
    .where('lastOrderAt', '<=', windowEnd)
    .get();

  const candidates = [];
  const skipped = [];
  const userDocs = usersSnap.docs;

  // Each user needs a "latest order" lookup, so this is inherently N+1. Doing
  // them sequentially made the list crawl on a busy 15-day window, so fetch in
  // parallel batches - same approach as pages/api/customers.js.
  const BATCH_SIZE = 50;

  for (let i = 0; i < userDocs.length; i += BATCH_SIZE) {
    const batch = userDocs.slice(i, i + BATCH_SIZE);

    const results = await Promise.all(batch.map(async (userDoc) => {
      const uid = userDoc.id;
      // One user's failed read must not sink the whole scan: without this
      // isolation, a single rejected orders .get() rejects the whole
      // Promise.all, 500s the candidates list, and aborts send-all before it
      // starts. Skip that user with a reason instead.
      try {
      const user = userDoc.data();

      const orderSnap = await userDoc.ref
        .collection('orders')
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();

      if (orderSnap.empty) return { skip: { uid, reason: 'no order doc' } };

      const orderDoc = orderSnap.docs[0];
      const order = orderDoc.data();
      const orderId = orderDoc.id;

      const r = evaluateCandidate({
        user, order, orderId, now, requireDispatched, windowMinDays, windowMaxDays, cooldownDays,
      });

      if (!r.eligible) return { skip: { uid, orderId, reason: r.reason } };

      return {
        candidate: {
          uid,
          orderId,
          email: r.email,
          isGuest: Boolean(r.isGuest),
          senderName: r.senderName,
          lat: r.lat,
          lng: r.lng,
          city: r.city,
          placedAt: r.placedAt,
          canSendNow: r.canSendNow,
          cooldownActive: r.cooldownActive,
          lastSentAt: r.lastSentAt,
          sendCount: r.sendCount,
          history: sendHistory(user),
          marker: travelerDinnerMarker(user),
          lastRestaurant: order.restaurantName || null,
        },
      };
      } catch (err) {
        console.error(`[TravelerDinner] candidate read failed for ${uid}:`, err.message);
        return { skip: { uid, reason: 'read error' } };
      }
    }));

    for (const res of results) {
      if (res.skip) skipped.push(res.skip);
      else if (res.candidate) candidates.push(res.candidate);
    }
  }

  return { candidates, skipped, scanned: usersSnap.size };
}

/** Load a single (user, latest-order) pair by uid and evaluate it. */
async function loadCandidateByUid({ db, uid, now, ...opts }) {
  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) return null;
  const user = userSnap.data();

  const orderSnap = await userRef
    .collection('orders')
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  if (orderSnap.empty) {
    return { user, uid, userRef, order: null, orderId: null, evaluation: { eligible: false, reason: 'no order doc' } };
  }

  const orderDoc = orderSnap.docs[0];
  const order = orderDoc.data();
  const orderId = orderDoc.id;
  const evaluation = evaluateCandidate({ user, order, orderId, now, ...opts });

  return { user, uid, userRef, order, orderId, evaluation };
}

/** Restaurant ids shown in the user's LAST email - the rotation exclude list. */
function lastShownRestaurantIds(user) {
  const m = travelerDinnerMarker(user);
  return Array.isArray(m?.lastRestaurantIds) ? m.lastRestaurantIds : [];
}

// ── Past-order favorites ("Order again" section) ─────────────────────────────

/**
 * PURE: group a customer's past orders into repeat restaurants near the
 * current trip location. Only orders delivered within ~maxKm of the link's
 * coords count (a favorite from their home city is useless on a trip), only
 * non-cancelled orders, and only restaurants ordered from >= minCount times -
 * one visit isn't a favorite. Orders carry a flat `restaurantId` (field
 * verified against prod docs 2026-07-25) + restaurantName + delivery coords.
 */
function computePastFavorites(orders, { lat, lng, maxKm = 15, minCount = 2, cap = 3 }) {
  const KM_PER_DEGREE = 111;
  const cosLat = Math.cos((Number(lat) * Math.PI) / 180);
  const counts = new Map(); // restaurantId -> { name, count, lastAt }

  for (const o of orders || []) {
    if (!o || o.status === 'cancelled') continue;
    const rid = o.restaurantId != null ? String(o.restaurantId) : null;
    if (!rid) continue;
    const oLat = Number(o.recipient?.location?.lat);
    const oLng = Number(o.recipient?.location?.lng);
    if (!Number.isFinite(oLat) || !Number.isFinite(oLng)) continue;
    if (
      Math.abs(oLat - Number(lat)) * KM_PER_DEGREE > maxKm ||
      Math.abs(oLng - Number(lng)) * KM_PER_DEGREE * cosLat > maxKm
    ) continue;

    const prev = counts.get(rid) || { name: o.restaurantName || '', count: 0, lastAt: 0 };
    prev.count += 1;
    prev.lastAt = Math.max(prev.lastAt, Number(o.createdAt) || 0);
    if (o.restaurantName) prev.name = o.restaurantName;
    counts.set(rid, prev);
  }

  return [...counts.entries()]
    .filter(([, v]) => v.count >= minCount)
    .sort((a, b) => b[1].count - a[1].count || b[1].lastAt - a[1].lastAt)
    .slice(0, cap)
    .map(([restaurantId, v]) => ({ restaurantId, name: v.name, count: v.count }));
}

/** Read the customer's recent orders and compute trip-local favorites. */
async function getPastFavorites({ db, uid, lat, lng }) {
  try {
    const snap = await db
      .collection('users').doc(uid)
      .collection('orders')
      .orderBy('createdAt', 'desc')
      .limit(30)
      .get();
    return computePastFavorites(snap.docs.map((d) => d.data()), { lat, lng });
  } catch (err) {
    // Favorites are an enhancement - never let them block a send.
    console.warn('[TravelerDinner] favorites read failed:', err.message);
    return [];
  }
}

/**
 * Build the send marker to merge onto the user doc, appending to history.
 * `shownRestaurantIds` become the next send's exclude list, so two consecutive
 * emails never show the same selection.
 */
function buildSentMarker({ existingMarker, orderId, lat, lng, sentAt, sentBy, channel = 'admin', shownRestaurantIds = [] }) {
  const prev = Array.isArray(existingMarker?.history) ? existingMarker.history : [];
  const entry = {
    sentAt,
    orderId,
    channel,
    ...(sentBy ? { sentBy } : {}),
    ...(shownRestaurantIds.length ? { restaurantIds: shownRestaurantIds } : {}),
  };
  const history = [...prev, entry].slice(-HISTORY_CAP);
  return {
    lifecycleEmails: {
      [LIFECYCLE_KEY]: {
        sent: true,
        lastSentAt: sentAt,
        lastOrderId: orderId,
        lastLat: lat,
        lastLng: lng,
        lastRestaurantIds: shownRestaurantIds,
        count: history.length,
        channel,
        ...(sentBy ? { sentBy } : {}),
        history,
      },
    },
  };
}

module.exports = {
  LIFECYCLE_KEY,
  DAY_MS,
  DEFAULT_WINDOW_MIN_DAYS,
  DEFAULT_WINDOW_MAX_DAYS,
  DEFAULT_COOLDOWN_DAYS,
  isSelfOrder,
  cleanSenderName,
  getOrderLatLng,
  orderIsDispatched,
  travelerDinnerMarker,
  lastSentAt,
  sendCount,
  sendHistory,
  cooldownActive,
  lastShownRestaurantIds,
  computePastFavorites,
  getPastFavorites,
  evaluateCandidate,
  findTravelerDinnerCandidates,
  loadCandidateByUid,
  buildSentMarker,
};
