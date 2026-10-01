import { db, admin } from '../../lib/firebase';
import { requireAuth } from '../../lib/withAuth';
export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { to, from, subject, body, orderRef } = req.body;

    if (!to || !to.trim()) {
      return res.status(400).json({ error: 'Recipient email is required' });
    }
    if (!subject || !subject.trim()) {
      return res.status(400).json({ error: 'Subject is required' });
    }
    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'Email body is required' });
    }

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) {
      return res.status(400).json({ error: 'Resend API key not configured' });
    }

    const { Resend } = require('resend');

    const resend = new Resend(RESEND_API_KEY);

    // Build the from address with display name
    const fromAddressMap = {
      'support@foodtoindia.com': 'FoodtoIndia Support <support@foodtoindia.com>',
      'orders@foodtoindia.com': 'FoodtoIndia <orders@foodtoindia.com>',
      'santhosh@foodtoindia.com': 'Santhosh - FoodtoIndia <santhosh@foodtoindia.com>',
    };
    const fromAddress = fromAddressMap[from] || fromAddressMap['support@foodtoindia.com'];

    // Build order reference HTML
    const orderRefHtml = buildOrderRefHtml(orderRef);

    // Convert plain text body to HTML (preserve line breaks)
    const bodyHtml = body.trim().replace(/\n/g, '<br>');

    const fullHtml = `
<div style="font-family: Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.6;">
  ${bodyHtml}
  ${orderRefHtml}
  <div style="margin-top: 30px; padding-top: 15px; border-top: 1px solid #eee; font-size: 12px; color: #999;">
    FoodtoIndia Support<br>
    <a href="https://foodtoindia.com" style="color: #117150;">foodtoindia.com</a>
  </div>
</div>`;

    const { data: sendData, error: sendError } = await resend.emails.send({
      from: fromAddress,
      to: to.trim(),
      subject: subject.trim(),
      html: fullHtml,
      replyTo: from || 'support@foodtoindia.com',
    });

    if (sendError) {
      return res.status(500).json({ error: 'Failed to send email', message: sendError.message });
    }

    // Save to inbound-emails so it appears in inbox
    if (db) {
      const emailDoc = {
        from: fromAddress,
        to: [to.trim()],
        subject: subject.trim(),
        html: fullHtml,
        text: body.trim(),
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        read: true,
        direction: 'outbound',
        orderRef: orderRef || null,
        resendId: sendData?.id || null,
      };

      await db.collection('inbound-emails').add(emailDoc);
    }

    return res.status(200).json({
      success: true,
      resendId: sendData?.id,
      message: 'Email sent successfully',
    });
  } catch (error) {
    console.error('Order email error:', error);
    return res.status(500).json({ error: 'Failed to send email', message: error.message });
  }
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
