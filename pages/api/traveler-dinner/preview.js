import { db } from '../../../lib/firebase';
import { requireAuth } from '../../../lib/withAuth';
import {
  loadCandidateByUid,
  getOrderLatLng,
  sendHistory,
  lastShownRestaurantIds,
  getPastFavorites,
} from '../../../lib/travelerDinnerEligibility';
import { getTravelerDinnerSelection } from '../../../lib/travelerDinnerRestaurants';
import { buildTravelerDinnerEmailHtml, SUBJECT } from '../../../lib/travelerDinnerEmailTemplate';

/**
 * Render the EXACT email a given customer would receive - same restaurant
 * selection (including rotation vs their last send) and same template the send
 * path uses, so the preview is what actually goes out.
 * GET ?uid=..&orderId=..
 */
export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { uid, orderId } = req.query;
  if (!uid) return res.status(400).json({ error: 'uid required' });

  try {
    const now = Date.now();
    const requireDispatched = process.env.TRAVELER_DINNER_REQUIRE_DISPATCHED !== 'false';
    const loaded = await loadCandidateByUid({ db, uid, now, requireDispatched });
    if (!loaded) return res.status(404).json({ error: 'User not found' });

    const { user, order, orderId: latestOrderId, evaluation } = loaded;
    if (!order) return res.status(404).json({ error: 'No order for user' });

    // Guard against previewing a stale order id from the list.
    if (orderId && orderId !== latestOrderId) {
      return res.status(409).json({ error: "Order is no longer this customer's latest order", latestOrderId });
    }

    const latLng = getOrderLatLng(order);
    if (!latLng) {
      return res.status(422).json({ error: 'No usable delivery coordinates on this order', evaluation });
    }

    const senderName = evaluation.senderName || '';
    const recipientEmail = evaluation.email || user.email;
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
    });

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

    return res.status(200).json({
      html,
      subject: SUBJECT,
      eligible: evaluation.eligible,
      reason: evaluation.eligible ? null : evaluation.reason,
      canSendNow: evaluation.canSendNow,
      cooldownActive: evaluation.cooldownActive,
      lastSentAt: evaluation.lastSentAt,
      sendCount: evaluation.sendCount,
      history: sendHistory(user),
      candidate: {
        uid,
        orderId: latestOrderId,
        email: recipientEmail,
        senderName,
        city: order.restaurantCity || order.restaurantLocality || null,
        lat: latLng.lat,
        lng: latLng.lng,
      },
      cards: cards.map((c) => ({
        bucketKey: c.bucketKey,
        id: c.id,
        name: c.name,
        cuisineLabel: c.cuisineLabel,
        ratingLabel: c.ratingLabel,
        etaLabel: c.etaLabel,
        orderUrl: c.orderUrl,
      })),
      alsoDelivering,
      reorderRows,
    });
  } catch (error) {
    console.error('[TravelerDinner preview] Error:', error);
    return res.status(500).json({ error: 'Failed to build preview', message: error.message });
  }
}
