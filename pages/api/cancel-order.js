import { db, admin } from '../../lib/firebase';
import { requireAuth } from '../../lib/withAuth';
export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, orderId, reason, sendEmail, orderData } = req.body;

    if (!userId || !orderId) {
      return res.status(400).json({ error: 'userId and orderId are required' });
    }
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Cancellation reason is required' });
    }

    // Update order status in Firestore
    const orderRef = db.collection('users').doc(userId).collection('orders').doc(orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const currentStatus = orderDoc.data().status || 'pending';
    if (currentStatus === 'cancelled') {
      return res.status(400).json({ error: 'Order is already cancelled' });
    }

    await orderRef.update({
      status: 'cancelled',
      cancellationReason: reason.trim(),
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      cancelledBy: session.user?.email || 'admin',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Invalidate orders cache
    global.ordersCache = null;

    // Send cancellation email if requested
    let emailSent = false;
    if (sendEmail && orderData?.senderEmail) {
      try {
        emailSent = await sendCancellationEmail({
          to: orderData.senderEmail,
          senderName: orderData.senderName,
          reason: reason.trim(),
          orderRef: {
            orderId: orderId.slice(0, 12),
            date: orderData.date,
            recipientName: orderData.recipientName,
            recipientPhone: orderData.recipientPhone,
            restaurantName: orderData.restaurantName,
            items: orderData.items || [],
          },
        });

        // Save outbound email to inbox
        if (emailSent && db) {
          await db.collection('inbound-emails').add({
            from: 'FoodtoIndia <orders@foodtoindia.com>',
            to: [orderData.senderEmail],
            subject: `Order Cancelled: ${orderData.recipientName ? `Order for ${orderData.recipientName}` : `Order ${orderId.slice(0, 8)}`}`,
            text: `Your order has been cancelled. Reason: ${reason.trim()}`,
            receivedAt: admin.firestore.FieldValue.serverTimestamp(),
            read: true,
            direction: 'outbound',
            orderRef: { orderId, userId },
          });
        }
      } catch (emailErr) {
        console.error('Failed to send cancellation email:', emailErr);
        // Don't fail the whole request if email fails
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Order cancelled successfully',
      emailSent,
    });
  } catch (error) {
    console.error('Cancel order error:', error);
    return res.status(500).json({ error: 'Failed to cancel order', message: error.message });
  }
}

async function sendCancellationEmail({ to, senderName, reason, orderRef }) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured');
    return false;
  }

  const { Resend } = require('resend');
  const resend = new Resend(RESEND_API_KEY);

  const firstName = senderName ? senderName.split(' ')[0] : 'there';

  const orderRefHtml = buildOrderRefHtml(orderRef);

  const html = `
<div style="font-family: Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.6;">
  <p>Hi ${firstName},</p>
  <p>We wanted to let you know that your order has been cancelled.</p>
  <div style="margin: 16px 0; padding: 12px 16px; background-color: #f8f9fa; border-radius: 6px; border-left: 3px solid #dc3545;">
    <strong>Reason:</strong> ${reason}
  </div>
  <p>If you have any questions, please reply to this email and we'll be happy to help.</p>
  ${orderRefHtml}
  <div style="margin-top: 30px; padding-top: 15px; border-top: 1px solid #eee; font-size: 12px; color: #999;">
    FoodtoIndia Support<br>
    <a href="https://foodtoindia.com" style="color: #117150;">foodtoindia.com</a>
  </div>
</div>`;

  const subject = `Order Cancelled: ${orderRef.recipientName ? `Order for ${orderRef.recipientName}` : `Order ${orderRef.orderId}`}`;

  const { data: sendData, error: sendError } = await resend.emails.send({
    from: 'FoodtoIndia <orders@foodtoindia.com>',
    to: to.trim(),
    subject,
    html,
    replyTo: 'support@foodtoindia.com',
  });

  if (sendError) {
    console.error('Resend error:', sendError);
    return false;
  }

  return true;
}

function buildOrderRefHtml(orderRef) {
  if (!orderRef) return '';

  const items = orderRef.items || [];
  const itemsHtml = items.length > 0
    ? items.map(item =>
        `<tr>
          <td style="padding: 4px 12px; font-size: 13px; color: #333;">${item.name}</td>
          <td style="padding: 4px 12px; font-size: 13px; color: #666; text-align: center;">${item.quantity}</td>
        </tr>`
      ).join('')
    : '';

  return `
  <div style="margin-top: 25px; padding-top: 20px; border-top: 1px solid #ddd;">
    <div style="font-size: 13px; font-weight: bold; color: #666; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px;">Order Reference</div>
    <table style="width: 100%; max-width: 420px; border-collapse: collapse; background-color: #faf8f5; border-radius: 6px;">
      <tr>
        <td style="padding: 8px 12px; font-size: 13px; color: #8A8279;">Order ID</td>
        <td style="padding: 8px 12px; font-size: 13px; color: #333; font-weight: bold;">${orderRef.orderId || ''}</td>
      </tr>
      <tr>
        <td style="padding: 4px 12px; font-size: 13px; color: #8A8279;">Date</td>
        <td style="padding: 4px 12px; font-size: 13px; color: #333;">${orderRef.date || ''}</td>
      </tr>
      <tr>
        <td style="padding: 4px 12px; font-size: 13px; color: #8A8279;">Recipient</td>
        <td style="padding: 4px 12px; font-size: 13px; color: #333;">${orderRef.recipientName || ''}</td>
      </tr>
      <tr>
        <td style="padding: 4px 12px; font-size: 13px; color: #8A8279;">Phone</td>
        <td style="padding: 4px 12px; font-size: 13px; color: #333;">${orderRef.recipientPhone || ''}</td>
      </tr>
      <tr>
        <td style="padding: 4px 12px; font-size: 13px; color: #8A8279;">Restaurant</td>
        <td style="padding: 4px 12px; font-size: 13px; color: #333;">${orderRef.restaurantName || ''}</td>
      </tr>
      ${itemsHtml ? `
      <tr>
        <td colspan="2" style="padding: 8px 12px 4px; font-size: 12px; font-weight: 700; color: #8A8279; text-transform: uppercase; letter-spacing: 0.05em; border-top: 1px solid #EDE8E1;">Items</td>
      </tr>
      ${itemsHtml}` : ''}
    </table>
  </div>`;
}
