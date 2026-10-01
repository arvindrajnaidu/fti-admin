// POST /api/whatsapp/log-sent
//
// Called when ops clicks the WhatsApp button on an order row. Records the
// contact attempt on the order doc and returns the (possibly newly
// generated) confirmation token + URL so the client can build the wa.me
// link with a stable token across re-sends.
//
// Body: { userId, orderId }
// Response: { confirmToken, confirmationPageUrl, status, whatsappSentAt }

import { db, admin } from '../../../lib/firebase';
import { requireAuth } from '../../../lib/withAuth';
import { randomUUID } from 'crypto';

const CONFIRMATION_BASE_URL =
  process.env.NEXT_PUBLIC_CONFIRMATION_BASE_URL || 'https://foodtoindia.com';

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, orderId } = req.body || {};
    if (!userId || !orderId) {
      return res.status(400).json({ error: 'userId and orderId are required' });
    }

    const orderRef = db.collection('users').doc(userId).collection('orders').doc(orderId);
    const snap = await orderRef.get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const existing = snap.data()?.recipientContact || null;

    // Re-use the existing token if one is set so a previously-sent
    // WhatsApp link (and any browser tabs the recipient still has open)
    // keeps working. Only the timestamp updates on re-send.
    const confirmToken = existing?.confirmToken || randomUUID();
    const confirmationPageUrl = `${CONFIRMATION_BASE_URL}/confirm/${orderId}?token=${confirmToken}`;

    // Preserve `status` when re-sending. If the recipient has already
    // confirmed, we don't want a fresh click from ops to flip the row
    // back to 'pending'.
    const nextStatus = existing?.status === 'confirmed' ? 'confirmed' : 'pending';

    const batch = db.batch();
    batch.update(orderRef, {
      'recipientContact.confirmToken': confirmToken,
      'recipientContact.confirmationPageUrl': confirmationPageUrl,
      'recipientContact.whatsappSentAt': admin.firestore.FieldValue.serverTimestamp(),
      'recipientContact.status': nextStatus,
    });

    // Public-facing lookup doc. The confirm page fetches this directly
    // via doc-path (no collection-group query), validates the token,
    // then loads the actual order using {userId, orderId}. Keeps the
    // public-readable surface minimal — no PII or order details here.
    const lookupRef = db.collection('confirm-lookups').doc(orderId);
    batch.set(lookupRef, {
      userId,
      orderId,
      confirmToken,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    await batch.commit();

    // Invalidate the orders-list cache so the next refresh shows the
    // updated row.
    global.ordersCache = null;

    return res.status(200).json({
      success: true,
      confirmToken,
      confirmationPageUrl,
      status: nextStatus,
    });
  } catch (err) {
    console.error('whatsapp/log-sent error:', err);
    return res.status(500).json({ error: 'Failed to log WhatsApp send' });
  }
}
