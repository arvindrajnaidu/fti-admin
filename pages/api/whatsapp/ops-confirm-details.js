// POST /api/whatsapp/ops-confirm-details
//
// One-shot endpoint for the unified ops "Confirm delivery details"
// modal. Writes any combination of:
//   - recipient address  (recipientContact.confirmedAddress)
//   - delivery time slot (recipientContact.opsConfirmedTimeSlot)
//   - status flip        (recipientContact.status = 'confirmed')
//
// All fields are optional except userId + orderId. Server ignores
// no-op fields. One Firestore batch so partial failures can't leave
// the order doc in a half-saved state.
//
// Body:
//   userId, orderId,
//   address?: { doorFlat, street, landmark, area, city, state, pincode },
//   scheduledFor?: number | 'asap',
//   mealWindow?: 'breakfast' | 'lunch' | 'snack' | 'dinner',
//   markAsConfirmed?: boolean

import { db, admin } from '../../../lib/firebase';
import { requireAuth } from '../../../lib/withAuth';
import {
  normalizeAddress,
  hasMeaningfulAddress,
  isValidE164,
  COLLECTION,
} from '../../../lib/recipientProfile';
const { MEAL_WINDOWS, isSlotInMealWindow } = require('../../../lib/scheduling');

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { userId, orderId, address, scheduledFor, mealWindow, markAsConfirmed } = req.body || {};
    if (!userId || !orderId) {
      return res.status(400).json({ error: 'userId and orderId are required' });
    }

    const hasAddressUpdate = address && typeof address === 'object';
    const hasTimeUpdate =
      scheduledFor !== undefined &&
      scheduledFor !== null &&
      scheduledFor !== '';

    if (!hasAddressUpdate && !hasTimeUpdate && !markAsConfirmed) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    let normalizedAddr = null;
    if (hasAddressUpdate) {
      normalizedAddr = normalizeAddress(address);
      if (!hasMeaningfulAddress(normalizedAddr)) {
        return res.status(400).json({
          error: 'Address must include at least one meaningful field (door, street, landmark, area, or city).',
        });
      }
    }

    const orderRef = db.collection('users').doc(userId).collection('orders').doc(orderId);
    const snap = await orderRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'Order not found' });
    const data = snap.data() || {};
    const phoneE164 = data.recipient?.recipientPhoneE164 || null;
    const opsEmail = session.user?.email || 'admin';
    const ts = admin.firestore.FieldValue.serverTimestamp();

    let timeValue = null;
    let timeMealWindow = null;
    if (hasTimeUpdate) {
      if (scheduledFor === 'asap') {
        timeValue = 'asap';
      } else if (typeof scheduledFor === 'number' && Number.isFinite(scheduledFor)) {
        timeValue = scheduledFor;
        const originalMealWindow = data.scheduling?.mealWindow || null;
        const preservedOriginalWindow =
          timeValue === data.scheduling?.scheduledFor ? originalMealWindow : null;
        timeMealWindow = mealWindow || preservedOriginalWindow || null;
        if (mealWindow || originalMealWindow) {
          if (!timeMealWindow) {
            return res.status(400).json({ error: 'missing_meal_window', reason: 'missing_meal_window' });
          }
          if (!MEAL_WINDOWS.some((window) => window.id === timeMealWindow)) {
            return res.status(400).json({ error: 'invalid_meal_window', reason: 'invalid_meal_window' });
          }
          if (!isSlotInMealWindow(timeValue, timeMealWindow)) {
            return res.status(400).json({ error: 'meal_window_mismatch', reason: 'meal_window_mismatch' });
          }
        }
      } else {
        return res.status(400).json({ error: 'invalid_scheduled_for' });
      }
    }

    const orderUpdate = {};

    if (hasAddressUpdate) {
      orderUpdate['recipientContact.confirmedAddress'] = normalizedAddr;
      orderUpdate['recipientContact.opsAddressSetAt'] = ts;
      orderUpdate['recipientContact.opsAddressSetBy'] = opsEmail;
    }
    if (hasTimeUpdate) {
      orderUpdate['recipientContact.opsConfirmedTimeSlot'] = timeValue;
      if (timeMealWindow) orderUpdate['recipientContact.opsConfirmedMealWindow'] = timeMealWindow;
      else orderUpdate['recipientContact.opsConfirmedMealWindow'] = admin.firestore.FieldValue.delete();
      orderUpdate['recipientContact.opsTimeSetAt'] = ts;
      orderUpdate['recipientContact.opsTimeSetBy'] = opsEmail;
    }
    if (markAsConfirmed) {
      orderUpdate['recipientContact.status'] = 'confirmed';
      orderUpdate['recipientContact.confirmedAt'] = ts;
      orderUpdate['recipientContact.confirmedBy'] = `ops:${opsEmail}`;
    }

    const batch = db.batch();
    batch.update(orderRef, orderUpdate);

    if (hasAddressUpdate && isValidE164(phoneE164)) {
      const profileRef = db.collection(COLLECTION).doc(phoneE164);
      batch.set(profileRef, {
        name: data.recipient?.name || '',
        confirmedAddress: normalizedAddr,
        addressSource: 'ops_updated',
        addressUpdatedAt: ts,
        lastOrderId: orderId,
      }, { merge: true });
    }

    await batch.commit();
    global.ordersCache = null;

    return res.status(200).json({
      success: true,
      addressUpdated: hasAddressUpdate,
      timeUpdated: hasTimeUpdate,
      markedConfirmed: !!markAsConfirmed,
    });
  } catch (err) {
    console.error('whatsapp/ops-confirm-details error:', err);
    return res.status(500).json({ error: 'Failed to save delivery details' });
  }
}
