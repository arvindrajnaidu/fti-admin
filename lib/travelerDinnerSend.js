// Single send path for the traveler dinner email - used by BOTH the per-person
// "Send" button and the "Send all eligible" batch, so eligibility re-checks,
// rotation, Resend call, and marker writes can never drift between the two.
const { Resend } = require('resend');
const {
  loadCandidateByUid,
  getOrderLatLng,
  buildSentMarker,
  travelerDinnerMarker,
  lastShownRestaurantIds,
  getPastFavorites,
  cooldownActive,
} = require('./travelerDinnerEligibility');
const { getTravelerDinnerSelection } = require('./travelerDinnerRestaurants');
const { buildTravelerDinnerEmailHtml, SUBJECT } = require('./travelerDinnerEmailTemplate');

// Real sends only go out 12:00-21:00 IST (noon so afternoon planning sends
// work, 9pm cap so "dinner tonight" stays honest). The email says
// "tonight" and "Order before 10pm IST"; without this guard an admin clicking
// from a US timezone at 1pm PT would email customers at 1:30am IST. Test sends
// are exempt (send-test.js does not use this path's guard).
const IST_OFFSET_MINUTES = 5 * 60 + 30;
const parseHour = (raw, fallback) => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 24 ? n : fallback;
};
const SEND_WINDOW_START_IST = parseHour(process.env.TRAVELER_DINNER_SEND_START_HOUR_IST, 12);
const SEND_WINDOW_END_IST = parseHour(process.env.TRAVELER_DINNER_SEND_END_HOUR_IST, 21);

/** Pure so it's unit-testable: is `now` (epoch ms) inside the IST send window? */
function isWithinSendWindowIST(now, startHour = SEND_WINDOW_START_IST, endHour = SEND_WINDOW_END_IST) {
  const d = new Date(now);
  const istMinutes = (d.getUTCHours() * 60 + d.getUTCMinutes() + IST_OFFSET_MINUTES) % (24 * 60);
  const istHour = istMinutes / 60;
  return istHour >= startHour && istHour < endHour;
}

/**
 * Validate + send to ONE customer. Never throws for business reasons - returns
 * { ok: true, sentTo, sentAt, ... } or { ok: false, status, error, reason }.
 *
 * Duplicate-send safety (adversarial finding C1): the cooldown check and the
 * marker write happen ATOMICALLY in a Firestore transaction, and the marker is
 * claimed BEFORE the email goes out. Two overlapping invocations (two admins,
 * a timed-out send-all plus a retry) serialize on the transaction - the second
 * one sees the fresh marker and gets a cooldown refusal instead of emailing
 * the customer twice. The traded failure mode: a crash between claim and
 * Resend leaves a marker with no email (a missed send, visible in history and
 * logs) - far safer for customers than a duplicate. A Resend failure after the
 * claim triggers a best-effort revert of the marker, loudly logged either way.
 *
 * @param {object} args
 * @param {FirebaseFirestore.Firestore} args.db
 * @param {string} args.uid
 * @param {string} [args.expectedOrderId] - refuse if no longer the latest order
 * @param {string} args.sentBy - admin username
 */
async function sendTravelerDinnerToUser({ db, uid, expectedOrderId, sentBy }) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return { ok: false, status: 500, error: 'RESEND_API_KEY not configured' };

  const now = Date.now();
  if (!isWithinSendWindowIST(now)) {
    return {
      ok: false,
      status: 409,
      error: `Outside the IST send window (${SEND_WINDOW_START_IST}:00-${SEND_WINDOW_END_IST}:00 IST). The email promises dinner tonight - sends are blocked at other hours.`,
      reason: 'outside send window',
    };
  }
  const requireDispatched = process.env.TRAVELER_DINNER_REQUIRE_DISPATCHED !== 'false';
  const loaded = await loadCandidateByUid({ db, uid, now, requireDispatched });
  if (!loaded || !loaded.order) return { ok: false, status: 404, error: 'User or order not found' };

  const { user, order, orderId: latestOrderId, userRef, evaluation } = loaded;

  if (expectedOrderId && expectedOrderId !== latestOrderId) {
    return { ok: false, status: 409, error: 'Order is no longer the latest order', latestOrderId };
  }
  if (!evaluation.eligible) {
    return { ok: false, status: 409, error: 'Not eligible', reason: evaluation.reason };
  }
  // Fast pre-check (the authoritative check happens inside the transaction).
  if (!evaluation.canSendNow) {
    return { ok: false, status: 409, error: 'In cooldown', reason: 'cooldown active', lastSentAt: evaluation.lastSentAt };
  }

  const latLng = getOrderLatLng(order);
  if (!latLng) return { ok: false, status: 422, error: 'No usable delivery coordinates' };

  // evaluation.email/senderName are guest-aware (guestContact fallback);
  // user.email is undefined for guest-checkout travelers.
  const recipientEmail = evaluation.email;
  const senderName = evaluation.senderName;
  // Real sends always pull FRESH restaurant data (adversarial M4): the shared
  // 10-minute cache is fine for previews, but an email must not recommend a
  // restaurant whose open/closed state is up to 10 minutes stale.
  // City/area-level label for the guest delivery header (privacy rule:
  // never the street or hotel). Rides on every link as ?area=.
  const area = order.restaurantCity || order.restaurantLocality || undefined;

  const pastFavorites = await getPastFavorites({ db, uid, lat: latLng.lat, lng: latLng.lng });

  const { cards, alsoDelivering, reorderRows, shownIds } = await getTravelerDinnerSelection({
    lat: latLng.lat,
    lng: latLng.lng,
    excludeIds: lastShownRestaurantIds(user),
    pastFavorites,
    area,
    refresh: true,
  });

  // Quality gate: a dinner email with one or two lonely cards reads broken.
  // Below the floor, refuse with a clear reason instead of sending a weak email.
  const MIN_CARDS = Number(process.env.TRAVELER_DINNER_MIN_CARDS) > 0
    ? Number(process.env.TRAVELER_DINNER_MIN_CARDS) : 3;
  if (!cards || cards.length < MIN_CARDS) {
    return {
      ok: false,
      status: 422,
      error: `Only ${cards ? cards.length : 0} quality restaurant card(s) available at this location (minimum ${MIN_CARDS}) - not sending a thin email`,
    };
  }

  const html = buildTravelerDinnerEmailHtml({
    senderName,
    senderEmail: recipientEmail,
    lat: latLng.lat,
    lng: latLng.lng,
    area,
    cards,
    alsoDelivering,
    reorderRows,
  });

  // ── Atomic claim (before the email leaves) ─────────────────────────────────
  const sentAt = Date.now();
  let previousMarker = null;
  try {
    await db.runTransaction(async (tx) => {
      const freshSnap = await tx.get(userRef);
      const freshUser = freshSnap.exists ? freshSnap.data() : null;
      if (!freshUser) throw Object.assign(new Error('User vanished'), { code: 'gone' });
      if (freshUser.emailPreferences?.unsubscribed) {
        throw Object.assign(new Error('unsubscribed'), { code: 'unsubscribed' });
      }
      if (cooldownActive(freshUser, sentAt)) {
        throw Object.assign(new Error('cooldown'), { code: 'cooldown' });
      }
      previousMarker = travelerDinnerMarker(freshUser);
      tx.set(
        userRef,
        buildSentMarker({
          existingMarker: previousMarker,
          orderId: latestOrderId,
          lat: latLng.lat,
          lng: latLng.lng,
          sentAt,
          sentBy,
          channel: 'admin',
          shownRestaurantIds: shownIds,
        }),
        { merge: true }
      );
    });
  } catch (err) {
    if (err.code === 'cooldown') {
      return { ok: false, status: 409, error: 'In cooldown', reason: 'claimed by a concurrent send' };
    }
    if (err.code === 'unsubscribed') {
      return { ok: false, status: 409, error: 'Not eligible', reason: 'unsubscribed' };
    }
    if (err.code === 'gone') return { ok: false, status: 404, error: 'User not found' };
    return { ok: false, status: 500, error: `Claim failed: ${err.message}` };
  }

  // ── Send ───────────────────────────────────────────────────────────────────
  const resend = new Resend(RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: 'FoodtoIndia <orders@foodtoindia.com>',
    to: [recipientEmail],
    subject: SUBJECT,
    html,
    replyTo: 'support@foodtoindia.com',
    // Gmail/Yahoo bulk-sender compliance for a recurring campaign (adversarial
    // H4): one-click List-Unsubscribe, matching the in-body unsubscribe target.
    headers: {
      'List-Unsubscribe': `<https://www.foodtoindia.com/unsubscribe?email=${encodeURIComponent(recipientEmail)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });

  if (error) {
    // Claim is in place but the email did not go out - revert best-effort so
    // the customer isn't silently skipped for 2 days over a transient Resend
    // error. If the revert itself fails, the loud log is the recovery trail.
    try {
      const { admin } = require('./firebase');
      if (previousMarker) {
        await userRef.set({ lifecycleEmails: { travelerDinnerRecommendation: previousMarker } }, { merge: true });
      } else {
        await userRef.update({
          'lifecycleEmails.travelerDinnerRecommendation': admin.firestore.FieldValue.delete(),
        });
      }
      console.error(JSON.stringify({ event: 'traveler_dinner_claim_reverted', uid, orderId: latestOrderId, resendError: error.message }));
    } catch (revertErr) {
      console.error(JSON.stringify({ event: 'traveler_dinner_claim_revert_failed', uid, orderId: latestOrderId, resendError: error.message, revertError: revertErr.message }));
    }
    return { ok: false, status: 502, error: `Resend error: ${error.message}` };
  }

  // One JSON line per send, greppable in Vercel logs. The durable record is the
  // history log on the user doc (sentAt / sentBy / channel / restaurantIds).
  console.log(JSON.stringify({
    event: 'traveler_dinner_email_sent',
    uid,
    orderId: latestOrderId,
    sentBy,
    channel: 'admin',
    cardIds: cards.map((c) => c.id),
    alsoIds: alsoDelivering.map((r) => r.id),
  }));

  return {
    ok: true,
    sentTo: recipientEmail,
    sentAt,
    orderId: latestOrderId,
    cardCount: cards.length,
    alsoCount: alsoDelivering.length,
  };
}

module.exports = { sendTravelerDinnerToUser, isWithinSendWindowIST };
