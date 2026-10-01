import { requireAuth } from '../../lib/withAuth';
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { to, subject, bodyHtml, bodyText, attachments, from } = req.body;

    // Validate required fields
    if (!to || !to.trim()) {
      return res.status(400).json({ error: 'Email address is required' });
    }
    if (!subject || !subject.trim()) {
      return res.status(400).json({ error: 'Subject is required' });
    }
    if ((!bodyText || !bodyText.trim()) && (!attachments || attachments.length === 0)) {
      return res.status(400).json({ error: 'Email body is required' });
    }

    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) {
      return res.status(400).json({ error: 'Invalid email address format' });
    }

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) {
      return res.status(400).json({ error: 'Resend API key not configured' });
    }

    const { Resend } = require('resend');

    const resend = new Resend(RESEND_API_KEY);
    const fromAddressMap = {
      'support@foodtoindia.com': 'FoodtoIndia Support <support@foodtoindia.com>',
      'hello@foodtoindia.com': 'FoodtoIndia <hello@foodtoindia.com>',
      'santhosh@foodtoindia.com': 'Santhosh - FoodtoIndia <santhosh@foodtoindia.com>',
    };
    const fromAddress = fromAddressMap[from] || fromAddressMap['support@foodtoindia.com'];

    const sendPayload = {
      from: fromAddress,
      to: to.trim(),
      subject: subject.trim(),
      html: bodyHtml || `<pre>${bodyText}</pre>`,
    };

    const resendAttachments = (attachments || []).filter(a => a.filename && a.content).map(att => ({
      filename: att.filename,
      content: att.content,
    }));

    if (resendAttachments.length > 0) {
      sendPayload.attachments = resendAttachments;
    }

    const { data: sendData, error: sendError } = await resend.emails.send(sendPayload);

    if (sendError) {
      return res.status(500).json({ error: 'Failed to send email', message: sendError.message });
    }

    return res.status(200).json({
      success: true,
      resendId: sendData?.id,
      message: 'Email sent successfully',
    });
  } catch (error) {
    console.error('Compose error:', error);
    return res.status(500).json({ error: 'Failed to send email', message: error.message });
  }
}
