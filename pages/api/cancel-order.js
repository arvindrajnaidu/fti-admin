import { db, admin } from '../../lib/firebase';
import { requireAuth } from '../../lib/withAuth';
export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Cancelling now runs in the foodtoindia app (lib/dispatchOrder cancelOrder)
  // through its internal API, so the admin, Captain and the Slack shortcut
  // share one implementation: status + reason on the order, the Stripe refund,
  // the cancellation email in the customer's existing thread, the Slack thread
  // post and the reaction. The private Firestore write + email this route used
  // to do covered only the first and the third.
  const baseUrl = (process.env.FOODTOINDIA_BASE_URL || '').replace(/\/$/, '');
  const token = process.env.MCP_INTERNAL_TOKEN;
  if (!baseUrl || !token) {
    return res.status(500).json({ error: 'FOODTOINDIA_BASE_URL and MCP_INTERNAL_TOKEN must be configured' });
  }

  const { userId, orderId, reason, refund, orderData } = req.body || {};
  if (!userId || !orderId) {
    return res.status(400).json({ error: 'userId and orderId are required' });
  }
  if (!reason || !reason.trim()) {
    return res.status(400).json({ error: 'Cancellation reason is required' });
  }
  const refundOk =
    refund === undefined || refund === 'none' || refund === 'full' ||
    (refund && Number.isInteger(refund.amountCents) && refund.amountCents > 0);
  if (!refundOk) return res.status(400).json({ error: 'Invalid refund' });

  try {
    const upstream = await fetch(`${baseUrl}/api/internal/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': token },
      body: JSON.stringify({ orderRef: `${userId}-${orderId}`, reason: reason.trim(), refund: refund || 'full', actor: 'admin' }),
    });
    const body = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return res.status(upstream.status === 404 ? 404 : 502).json({ error: body.error || `foodtoindia answered ${upstream.status}` });
    }
    const result = body.result || {};
    if (result.status === 'already_cancelled') {
      return res.status(400).json({ error: 'Order is already cancelled' });
    }
    if (result.status !== 'cancelled') {
      return res.status(400).json({ error: result.reason || `Not cancelled (${result.status})` });
    }

    global.ordersCache = null;

    // Keep the admin inbox's record of what the customer was told.
    if (result.emailSent && db && orderData?.senderEmail) {
      try {
        await db.collection('inbound-emails').add({
          from: 'FoodtoIndia <support@foodtoindia.com>',
          to: [orderData.senderEmail],
          subject: `Order Cancelled: ${orderData.recipientName ? `Order for ${orderData.recipientName}` : `Order ${orderId.slice(0, 8)}`}`,
          text: `Your order has been cancelled. Reason: ${reason.trim()}` +
            (result.refund?.status === 'refunded' ? ` Refund: ${(result.refund.currency || 'usd').toUpperCase()} ${(result.refund.amountCents / 100).toFixed(2)}` : ''),
          receivedAt: admin.firestore.FieldValue.serverTimestamp(),
          read: true,
          direction: 'outbound',
          orderRef: { orderId, userId },
        });
      } catch (e) {
        console.error('Failed to record cancellation email in inbox:', e);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Order cancelled',
      emailSent: Boolean(result.emailSent),
      refund: result.refund || null,
    });
  } catch (error) {
    console.error('Cancel order error:', error);
    return res.status(500).json({ error: 'Failed to cancel order', message: error.message });
  }
}
