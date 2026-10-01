import { Resend } from 'resend';
import { db } from '../../../lib/firebase';
import { requireAuth } from '../../../lib/withAuth';
import { loadCandidateByUid, getOrderLatLng, lastShownRestaurantIds, getPastFavorites } from '../../../lib/travelerDinnerEligibility';
import { getTravelerDinnerSelection } from '../../../lib/travelerDinnerRestaurants';
import { buildTravelerDinnerEmailHtml, SUBJECT } from '../../../lib/travelerDinnerEmailTemplate';

// Test sends always go HERE, never to the customer. Hardcoded on purpose so a
// bad request body can never redirect a test at a real inbox.
const TEST_EMAIL_ADDRESS = 'ath.sub.007@gmail.com';

/**
 * Send a TEST copy of a customer's dinner email to the internal test inbox.
 * Renders exactly what that customer would receive (their name, their location's
 * restaurants, their rotation state) but:
 *   - delivers only to TEST_EMAIL_ADDRESS
 *   - subject is prefixed [TEST]
 *   - does NOT write the sent marker - no cooldown, history, or rotation change
 *   - skips the cooldown gate (testing must work even mid-cooldown)
 * POST { uid, orderId }
 */
export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { uid, orderId } = req.body || {};
  if (!uid) return res.status(400).json({ error: 'uid required' });

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return res.status(500).json({ error: 'RESEND_API_KEY not configured' });

  try {
    const now = Date.now();
    const requireDispatched = process.env.TRAVELER_DINNER_REQUIRE_DISPATCHED !== 'false';
    const loaded = await loadCandidateByUid({ db, uid, now, requireDispatched });
    if (!loaded || !loaded.order) return res.status(404).json({ error: 'User or order not found' });

    const { user, order, orderId: latestOrderId, evaluation } = loaded;
    if (orderId && orderId !== latestOrderId) {
      return res.status(409).json({ error: 'Order is no longer the latest order', latestOrderId });
    }

    const latLng = getOrderLatLng(order);
    if (!latLng) return res.status(422).json({ error: 'No usable delivery coordinates' });

    const senderName = evaluation.senderName || '';
    const recipientEmail = evaluation.email || user.email;

    // TEST sends point their links at FOODTOINDIA_BASE_URL (localhost:3000 in
    // local dev - the instance that has the menu deep-link code) so the full
    // click-through journey is testable before anything is deployed. Real sends
    // and previews never do this; their links are hardcoded to production.
    const linkOrigin = (process.env.FOODTOINDIA_BASE_URL || '').replace(/\/$/, '') || undefined;

    // City/area-level label for the guest delivery header (privacy rule:
    // never the street or hotel). Rides on every link as ?area=.
    const area = order.restaurantCity || order.restaurantLocality || undefined;
    const pastFavorites = await getPastFavorites({ db, uid, lat: latLng.lat, lng: latLng.lng });

    const { cards, alsoDelivering, reorderRows } = await getTravelerDinnerSelection({
      lat: latLng.lat,
      lng: latLng.lng,
      excludeIds: lastShownRestaurantIds(user),
      pastFavorites,
      area,
      linkOrigin,
    });
    if (!cards || cards.length === 0) {
      return res.status(422).json({ error: 'No restaurants found for this location' });
    }

    const html = buildTravelerDinnerEmailHtml({
      senderName,
      senderEmail: recipientEmail, // unsubscribe link etc. render as the customer's
      lat: latLng.lat,
      lng: latLng.lng,
      area,
      cards,
      alsoDelivering,
      reorderRows,
      linkOrigin,
    });

    const resend = new Resend(RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: 'FoodtoIndia <orders@foodtoindia.com>',
      to: [TEST_EMAIL_ADDRESS],
      subject: `[TEST] ${SUBJECT}`,
      html,
      replyTo: 'support@foodtoindia.com',
    });
    if (error) throw new Error(`Resend error: ${error.message}`);

    console.log(JSON.stringify({
      event: 'traveler_dinner_email_test_sent',
      uid,
      orderId: latestOrderId,
      sentBy: session.user?.username || 'admin',
      to: TEST_EMAIL_ADDRESS,
      cardIds: cards.map((c) => c.id),
    }));

    return res.status(200).json({ success: true, sentTo: TEST_EMAIL_ADDRESS, sentAt: Date.now() });
  } catch (error) {
    console.error('[TravelerDinner send-test] Error:', error);
    return res.status(500).json({ error: 'Failed to send test', message: error.message });
  }
}
