// POST /api/whatsapp/set-deliver-at
//
// Ops captures the recipient's verbal delivery commitment from a WhatsApp
// conversation. Stored as `recipientContact.opsConfirmedTimeSlot`, which
// overrides both the sender's original scheduling.scheduledFor AND any
// time the recipient picked via the public confirmation page.
//
// Body: { userId, orderId, scheduledFor, mealWindow }
//   scheduledFor: epoch ms, the string 'asap', or null to clear.
//   mealWindow: required when updating a meal-window scheduled order to a new time.

import { db, admin } from '../../../lib/firebase';
import { requireAuth } from '../../../lib/withAuth';
const { MEAL_WINDOWS, isSlotInMealWindow } = require('../../../lib/scheduling');

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { userId, orderId, scheduledFor, mealWindow } = req.body || {};
    if (!userId || !orderId) {
      return res.status(400).json({ error: 'userId and orderId are required' });
    }

    const orderRef = db.collection('users').doc(userId).collection('orders').doc(orderId);
    const snap = await orderRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'Order not found' });
    const data = snap.data() || {};

    let value;
    let timeMealWindow = null;
    if (scheduledFor === null || scheduledFor === undefined || scheduledFor === '') {
      value = null;
    } else if (scheduledFor === 'asap') {
      value = 'asap';
    } else if (typeof scheduledFor === 'number' && Number.isFinite(scheduledFor)) {
      value = scheduledFor;
      const originalMealWindow = data.scheduling?.mealWindow || null;
      const preservedOriginalWindow =
        value === data.scheduling?.scheduledFor ? originalMealWindow : null;
      timeMealWindow = mealWindow || preservedOriginalWindow || null;
      if (mealWindow || originalMealWindow) {
        if (!timeMealWindow) {
          return res.status(400).json({ error: 'missing_meal_window', reason: 'missing_meal_window' });
        }
        if (!MEAL_WINDOWS.some((window) => window.id === timeMealWindow)) {
          return res.status(400).json({ error: 'invalid_meal_window', reason: 'invalid_meal_window' });
        }
        if (!isSlotInMealWindow(value, timeMealWindow)) {
          return res.status(400).json({ error: 'meal_window_mismatch', reason: 'meal_window_mismatch' });
        }
      }
    } else {
      return res.status(400).json({ error: 'invalid_scheduled_for' });
    }

    const update = {
      'recipientContact.opsConfirmedTimeSlot': value,
      'recipientContact.opsTimeSetAt': admin.firestore.FieldValue.serverTimestamp(),
      'recipientContact.opsTimeSetBy': session.user?.email || 'admin',
      'recipientContact.opsConfirmedMealWindow': timeMealWindow || admin.firestore.FieldValue.delete(),
    };
    await orderRef.update(update);
    global.ordersCache = null;
    return res.status(200).json({ success: true, opsConfirmedTimeSlot: value, opsConfirmedMealWindow: timeMealWindow });
  } catch (err) {
    console.error('whatsapp/set-deliver-at error:', err);
    return res.status(500).json({ error: 'Failed to update deliver-at time' });
  }
}
