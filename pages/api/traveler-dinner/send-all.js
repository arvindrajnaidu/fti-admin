import { db } from '../../../lib/firebase';
import { requireAuth } from '../../../lib/withAuth';
import { findTravelerDinnerCandidates } from '../../../lib/travelerDinnerEligibility';
import { sendTravelerDinnerToUser } from '../../../lib/travelerDinnerSend';

// Conservative default: 500ms between sends (~2/sec; Resend's documented team
// limit is 10/sec). Sequential on purpose - never send concurrently.
const parsePositiveInt = (raw, fallback) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const SEND_DELAY_MS = parsePositiveInt(process.env.TRAVELER_DINNER_EMAIL_SEND_DELAY_MS, 500);

// Cap one invocation's work so the serverless function finishes well inside its
// time limit instead of being killed mid-batch (each send = Firestore reads +
// up to 6 Swiggy searches + Resend + a write). The response reports `remaining`
// and the admin clicks again - claims are transactional, so repeat runs are
// safe. 20 sends x ~5s worst case ~= 100s, far under maxDuration below.
const MAX_PER_RUN = parsePositiveInt(process.env.TRAVELER_DINNER_MAX_PER_RUN, 20);

export const config = { maxDuration: 300 };

/**
 * Batch-send to every traveler who is due (in cohort AND off the 2-day
 * cooldown). Each send re-validates through the same shared path as the
 * per-person button, so a candidate who became ineligible mid-batch is skipped,
 * not emailed. POST {} - no body needed.
 */
export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const now = Date.now();
    const requireDispatched = process.env.TRAVELER_DINNER_REQUIRE_DISPATCHED !== 'false';
    const { candidates } = await findTravelerDinnerCandidates({ db, now, requireDispatched });
    const allDue = candidates.filter((c) => c.canSendNow);
    const due = allDue.slice(0, MAX_PER_RUN);

    const sentBy = session.user?.username || 'admin';
    const results = {
      attempted: due.length,
      remaining: allDue.length - due.length,
      sent: 0,
      skipped: 0,
      failed: 0,
      details: [],
    };

    for (const cand of due) {
      try {
        const r = await sendTravelerDinnerToUser({
          db,
          uid: cand.uid,
          expectedOrderId: cand.orderId,
          sentBy,
        });
        if (r.ok) {
          results.sent += 1;
          results.details.push({ uid: cand.uid, email: cand.email, status: 'sent' });
        } else {
          results.skipped += 1;
          results.details.push({ uid: cand.uid, email: cand.email, status: 'skipped', reason: r.reason || r.error });
        }
      } catch (err) {
        results.failed += 1;
        results.details.push({ uid: cand.uid, email: cand.email, status: 'failed', reason: err.message });
      }
      await new Promise((resolve) => setTimeout(resolve, SEND_DELAY_MS));
    }

    console.log(JSON.stringify({ event: 'traveler_dinner_send_all', sentBy, ...results, details: undefined }));
    return res.status(200).json(results);
  } catch (error) {
    console.error('[TravelerDinner send-all] Error:', error);
    return res.status(500).json({ error: 'Failed to batch send', message: error.message });
  }
}
