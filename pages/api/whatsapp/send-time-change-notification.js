// POST /api/whatsapp/send-time-change-notification
//
// Sender notification email — fired when the recipient changes the
// sender's selected delivery time via the public confirmation page. The
// confirmation page sets `recipientContact.pendingSenderNotification =
// true`; admin's dispatch queue scans for that flag on load and fires
// this endpoint per pending order. The endpoint uses a Firestore
// transaction to atomically claim the flag before sending, so multiple
// open tabs can't trigger duplicate emails.
//
// Body: { userId, orderId }

import { db, admin } from '../../../lib/firebase';
import { requireAuth } from '../../../lib/withAuth';

const { Resend } = require('resend');
const { formatDeliveryTimeWithWindow, formatSlotLabel } = require('../../../lib/scheduling');

const FROM = 'FoodtoIndia <orders@foodtoindia.com>';
const REPLY_TO = 'support@foodtoindia.com';

function formatIstTime(value, mealWindow) {
  if (value === 'asap') return 'ASAP';
  if (typeof value !== 'number') return null;
  return mealWindow
    ? formatDeliveryTimeWithWindow(mealWindow, value)
    : formatSlotLabel(value);
}

function buildHtml({ recipientName, oldTime, newTime, restaurantName }) {
  const safeName = recipientName || 'your recipient';
  return `<!doctype html>
<html><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#FFFBF7;color:#2D2A26">
<div style="max-width:520px;margin:24px auto;padding:24px;background:#fff;border:1px solid #E3DACC;border-radius:12px">
  <div style="border-bottom:2px solid #117150;padding-bottom:10px;margin-bottom:18px">
    <div style="font-family:Sanchez,serif;font-size:22px;color:#117150">FoodtoIndia</div>
  </div>
  <h2 style="font-family:Sanchez,serif;font-size:18px;color:#2D2A26;margin:0 0 12px">Delivery time updated</h2>
  <p style="font-size:15px;line-height:1.55;color:#2D2A26;margin:0 0 14px">
    <strong>${safeName}</strong> has updated the delivery time for the order from <strong>${restaurantName || 'the restaurant'}</strong>.
  </p>
  <div style="background:#F0EDE8;border-radius:8px;padding:12px 14px;margin:0 0 16px">
    ${oldTime ? `<div style="font-size:13px;color:#8A837A">Previously: <span style="text-decoration:line-through">${oldTime}</span></div>` : ''}
    <div style="font-size:16px;color:#0F7A52;font-weight:600">New time: ${newTime || 'ASAP'}</div>
  </div>
  <p style="font-size:14px;color:#57534E;line-height:1.55;margin:0 0 8px">
    We&apos;ll deliver at the updated time. No action needed from you — this email is just to keep you informed.
  </p>
  <p style="font-size:13px;color:#8A837A;margin:14px 0 0">
    Questions? Reply to this email.
  </p>
</div>
</body></html>`;
}

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { userId, orderId } = req.body || {};
    if (!userId || !orderId) {
      return res.status(400).json({ error: 'userId and orderId are required' });
    }

    const orderRef = db.collection('users').doc(userId).collection('orders').doc(orderId);

    // Atomic claim — only one process can set pendingSenderNotification
    // from true → false. The transaction returns the data we need to
    // build the email if we won the race; otherwise null.
    const claimed = await db.runTransaction(async (txn) => {
      const snap = await txn.get(orderRef);
      if (!snap.exists) return null;
      const data = snap.data();
      if (data?.recipientContact?.pendingSenderNotification !== true) return null;
      txn.update(orderRef, {
        'recipientContact.pendingSenderNotification': false,
        'recipientContact.senderNotifiedAt': admin.firestore.FieldValue.serverTimestamp(),
      });
      return data;
    });

    if (!claimed) {
      return res.status(200).json({ success: true, skipped: 'not_pending' });
    }

    if (!claimed.senderEmail) {
      console.warn('send-time-change-notification: order has no senderEmail', { orderId });
      return res.status(200).json({ success: true, skipped: 'no_sender_email' });
    }

    if (!process.env.RESEND_API_KEY) {
      console.error('send-time-change-notification: RESEND_API_KEY missing');
      return res.status(500).json({ error: 'Email not configured' });
    }

    const oldSlot = claimed.scheduling?.scheduledFor || null;
    const newSlot = claimed.recipientContact?.confirmedTimeSlot ?? null;
    const oldTime = oldSlot
      ? formatIstTime(oldSlot, claimed.scheduling?.mealWindow || null)
      : (claimed.scheduling?.mode === 'asap' ? 'ASAP' : null);
    const newTime = newSlot != null
      ? formatIstTime(newSlot, claimed.recipientContact?.confirmedMealWindow || null)
      : null;

    const recipientName = claimed.recipient?.name || '';
    const restaurantName = claimed.restaurantName || '';
    const html = buildHtml({ recipientName, oldTime, newTime, restaurantName });

    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error: resendError } = await resend.emails.send({
      from: FROM,
      replyTo: REPLY_TO,
      to: claimed.senderEmail,
      subject: `Delivery time updated for ${recipientName || 'your order'}`,
      html,
    });

    if (resendError) {
      console.error('Resend send error:', resendError);
      // Don't roll back the flag — re-sending isn't safe. Log + alert.
      return res.status(500).json({ error: 'Email send failed', detail: resendError.message });
    }

    return res.status(200).json({ success: true, sent: true });
  } catch (err) {
    console.error('send-time-change-notification error:', err);
    return res.status(500).json({ error: 'Notification failed' });
  }
}
