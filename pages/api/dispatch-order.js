import { requireAuth } from '../../lib/withAuth';

// Mark an order dispatched with its tracking link.
//
// Like cancel-order, the work runs in the foodtoindia app (lib/dispatchOrder
// markDispatched) through its internal API, so the admin, Captain and the Slack
// "Submit link" shortcut share one implementation: status + link on the order,
// the "on its way" email, the recipient's WhatsApp, the app push and the Slack
// thread post. Repeating the same link is a no-op there; a different link is
// treated as a correction.
export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const baseUrl = (process.env.FOODTOINDIA_BASE_URL || '').replace(/\/$/, '');
  const token = process.env.MCP_INTERNAL_TOKEN;
  if (!baseUrl || !token) {
    return res.status(500).json({ error: 'FOODTOINDIA_BASE_URL and MCP_INTERNAL_TOKEN must be configured' });
  }

  const { userId, orderId, trackingLink } = req.body || {};
  if (!userId || !orderId) {
    return res.status(400).json({ error: 'userId and orderId are required' });
  }
  const link = String(trackingLink || '').trim();
  if (!/^https?:\/\/\S+$/i.test(link)) {
    return res.status(400).json({ error: 'Enter the full tracking link, starting with https://' });
  }

  try {
    const upstream = await fetch(`${baseUrl}/api/internal/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': token },
      body: JSON.stringify({ orderRef: `${userId}-${orderId}`, trackingLink: link }),
    });
    const body = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return res.status(upstream.status === 404 ? 404 : 502).json({ error: body.error || `foodtoindia answered ${upstream.status}` });
    }
    const result = body.result || {};
    if (result.status !== 'dispatched' && result.status !== 'already_dispatched') {
      return res.status(400).json({ error: result.reason || `Not dispatched (${result.status})` });
    }

    global.ordersCache = null;

    return res.status(200).json({
      success: true,
      alreadyDispatched: result.status === 'already_dispatched',
      emailSent: Boolean(result.emailSent),
      whatsapp: result.whatsapp?.status || null,
      slackPosted: Boolean(result.slackPosted),
      replacedPreviousLink: result.replacedPreviousLink || null,
      trackingLink: link,
    });
  } catch (error) {
    console.error('Dispatch order error:', error);
    return res.status(500).json({ error: 'Failed to submit tracking link', message: error.message });
  }
}
