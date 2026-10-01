import { db } from '../../../lib/firebase';
import { requireAuth } from '../../../lib/withAuth';
import { sendTravelerDinnerToUser } from '../../../lib/travelerDinnerSend';

/**
 * Manually send the traveler dinner email to ONE customer. All validation,
 * rotation, sending, and marker writes live in lib/travelerDinnerSend.js
 * (shared with the send-all batch).
 * POST { uid, orderId }
 */
export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { uid, orderId } = req.body || {};
  if (!uid) return res.status(400).json({ error: 'uid required' });

  try {
    const result = await sendTravelerDinnerToUser({
      db,
      uid,
      expectedOrderId: orderId,
      sentBy: session.user?.username || 'admin',
    });

    if (!result.ok) {
      const { ok, status, ...body } = result;
      return res.status(status || 500).json(body);
    }
    const { ok, ...body } = result;
    return res.status(200).json({ success: true, ...body });
  } catch (error) {
    console.error('[TravelerDinner send] Error:', error);
    return res.status(500).json({ error: 'Failed to send', message: error.message });
  }
}
