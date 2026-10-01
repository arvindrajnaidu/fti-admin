import { db } from '../../../lib/firebase';
import { requireAuth } from '../../../lib/withAuth';
import { findTravelerDinnerCandidates } from '../../../lib/travelerDinnerEligibility';

/**
 * List travelers currently in the dinner-email cohort.
 * Runs entirely in the admin app against its own (prod) Firestore - no call to
 * foodtoindia, so it works locally with real data. Restaurants are pulled
 * per-person by the preview endpoint (that's the only part needing foodtoindia).
 */
export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const now = Date.now();
    const requireDispatched = process.env.TRAVELER_DINNER_REQUIRE_DISPATCHED !== 'false';
    const { candidates, skipped, scanned } = await findTravelerDinnerCandidates({
      db,
      now,
      requireDispatched,
    });

    // Only the fields the list needs (no raw order blob, no phone).
    const rows = candidates.map((c) => ({
      uid: c.uid,
      orderId: c.orderId,
      email: c.email,
      isGuest: c.isGuest,
      senderName: c.senderName,
      city: c.city,
      lat: c.lat,
      lng: c.lng,
      placedAt: c.placedAt,
      lastRestaurant: c.lastRestaurant,
      canSendNow: c.canSendNow,
      cooldownActive: c.cooldownActive,
      lastSentAt: c.lastSentAt,
      sendCount: c.sendCount,
      history: c.history,
    }));

    return res.status(200).json({
      now,
      scanned,
      candidateCount: rows.length,
      candidates: rows,
      skippedCount: skipped.length,
      // Skip tally helps sanity-check the funnel (e.g. lots of "not dispatched
      // (pending)" explains a thin list).
      skipReasons: skipped.reduce((acc, s) => {
        acc[s.reason] = (acc[s.reason] || 0) + 1;
        return acc;
      }, {}),
    });
  } catch (error) {
    console.error('[TravelerDinner candidates] Error:', error);
    return res.status(500).json({ error: 'Failed to load candidates', message: error.message });
  }
}
