import { db, admin } from '../../lib/firebase';
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

  if (!db) {
    return res.status(500).json({ error: 'Firebase not initialized' });
  }

  try {
    const { emailId, replyHtml, replyText, attachments, from } = req.body;

    if (!emailId || (!replyHtml && !replyText)) {
      return res.status(400).json({ error: 'Missing emailId or reply content' });
    }

    // Fetch original email
    const doc = await db.collection('inbound-emails').doc(emailId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Original email not found' });
    }

    const original = doc.data();

    // Allowlisted from addresses — only these can be used
    const fromAddressMap = {
      'support@foodtoindia.com': 'FoodtoIndia Support <support@foodtoindia.com>',
      'hello@foodtoindia.com': 'FoodtoIndia <hello@foodtoindia.com>',
      'santhosh@foodtoindia.com': 'Santhosh - FoodtoIndia <santhosh@foodtoindia.com>',
    };
    const replyFrom = fromAddressMap[from] || fromAddressMap['support@foodtoindia.com'];
    const replyTo = original.from;
    const replySubject = original.subject?.startsWith('Re:')
      ? original.subject
      : `Re: ${original.subject || '(no subject)'}`;

    // Check Resend API key
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) {
      return res.status(400).json({
        error: 'Resend API key not configured',
        message: 'Add RESEND_API_KEY to your .env.local file',
      });
    }

    const { Resend } = require('resend');

    const resend = new Resend(RESEND_API_KEY);

    // Build Resend attachments from uploaded files
    const resendAttachments = (attachments || []).map(att => ({
      filename: att.filename,
      content: att.content, // base64
    }));

    // Build quoted original for the email thread
    const originalDate = original.receivedAt?.toDate
      ? original.receivedAt.toDate().toLocaleString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
          hour: 'numeric', minute: '2-digit',
        })
      : original.receivedAt || '';
    const originalBody = original.html || `<pre>${original.text || ''}</pre>`;
    const quotedHtml = `<div style="padding-top:16px;margin-top:16px;border-top:1px solid #ccc;color:#555;font-size:13px;">`
      + `<p>On ${originalDate}, ${original.from} wrote:</p>`
      + `<blockquote style="margin:8px 0 0 0;padding:0 0 0 12px;border-left:2px solid #ccc;color:#555;">`
      + originalBody
      + `</blockquote></div>`;

    const replyBody = replyHtml || `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;">${replyText.replace(/\n/g, '<br>')}</div>`;
    const fullHtml = replyBody + quotedHtml;

    // Send reply via Resend
    const sendPayload = {
      from: replyFrom,
      to: replyTo,
      subject: replySubject,
      html: fullHtml,
      headers: {},
    };

    // Fix #9: Build full References chain for proper email threading
    if (original.messageId) {
      sendPayload.headers['In-Reply-To'] = original.messageId;
      const existingRefs = original.references || '';
      sendPayload.headers['References'] = existingRefs
        ? `${existingRefs} ${original.messageId}`
        : original.messageId;
    }

    if (resendAttachments.length > 0) {
      sendPayload.attachments = resendAttachments;
    }

    const { data: sendData, error: sendError } = await resend.emails.send(sendPayload);

    if (sendError) {
      return res.status(500).json({ error: 'Failed to send reply', message: sendError.message });
    }

    // Store reply in Firestore
    const replyRecord = {
      repliedAt: new Date().toISOString(),
      from: replyFrom,
      to: replyTo,
      subject: replySubject,
      html: replyHtml || `<pre>${replyText}</pre>`,
      resendId: sendData?.id || null,
      attachments: (attachments || []).map(att => ({
        filename: att.filename,
        storageUrl: att.storageUrl,
      })),
    };

    await db.collection('inbound-emails').doc(emailId).update({
      replies: admin.firestore.FieldValue.arrayUnion(replyRecord),
    });

    return res.status(200).json({
      success: true,
      resendId: sendData?.id,
      message: 'Reply sent successfully',
    });
  } catch (error) {
    console.error('Reply error:', error);
    return res.status(500).json({ error: 'Failed to send reply', message: error.message });
  }
}
