// POST /api/whatsapp/set-address
//
// Ops captures a corrected/confirmed address from a WhatsApp conversation
// with the recipient. Writes to BOTH the order doc and the global
// recipient profile so the next order to the same phone benefits.
//
// Body: { userId, orderId, address }
//   address: 7-field shape (doorFlat, street, landmark, area, city, state, pincode)

import { db, admin } from '../../../lib/firebase';
import { requireAuth } from '../../../lib/withAuth';
import {
  normalizeAddress,
  hasMeaningfulAddress,
  isValidE164,
  COLLECTION,
} from '../../../lib/recipientProfile';

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { userId, orderId, address } = req.body || {};
    if (!userId || !orderId) {
      return res.status(400).json({ error: 'userId and orderId are required' });
    }

    const normalized = normalizeAddress(address);
    if (!hasMeaningfulAddress(normalized)) {
      return res.status(400).json({ error: 'Door/flat or street is required.' });
    }

    const orderRef = db.collection('users').doc(userId).collection('orders').doc(orderId);
    const snap = await orderRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'Order not found' });
    const data = snap.data() || {};
    const phoneE164 = data.recipient?.recipientPhoneE164 || null;

    const batch = db.batch();
    batch.update(orderRef, {
      'recipientContact.confirmedAddress': normalized,
      'recipientContact.opsAddressSetAt': admin.firestore.FieldValue.serverTimestamp(),
      'recipientContact.opsAddressSetBy': session.user?.email || 'admin',
    });

    if (isValidE164(phoneE164)) {
      const profileRef = db.collection(COLLECTION).doc(phoneE164);
      batch.set(
        profileRef,
        {
          name: data.recipient?.name || '',
          confirmedAddress: normalized,
          addressSource: 'ops_updated',
          addressUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          lastOrderId: orderId,
        },
        { merge: true },
      );
    }

    await batch.commit();
    global.ordersCache = null;
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('whatsapp/set-address error:', err);
    return res.status(500).json({ error: 'Failed to update address' });
  }
}
