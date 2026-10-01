import { db, admin } from '../../../lib/firebase';
import { Webhook } from 'svix';
// Disable Next.js body parser to get raw body for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Fetch full email content from Resend API (webhook only sends metadata)
// Uses Resend SDK (already installed) to avoid webpack bundling issues with https module
async function fetchEmailContent(emailId) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — cannot fetch email body');
    return null;
  }

  try {
    const { Resend } = require('resend');
    const resend = new Resend(RESEND_API_KEY);

    // Use the Resend SDK's receiving.get() method
    const response = await resend.emails.receiving.get(emailId);
    console.log('Resend API response keys:', Object.keys(response || {}).join(', '));
    console.log('Resend API text length:', (response?.data?.text || response?.text || '').length);
    return response?.data || response;
  } catch (err) {
    console.error('Failed to fetch email content from Resend:', err.message);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!db) {
    return res.status(500).json({ error: 'Firebase not initialized' });
  }

  try {
    const rawBody = await getRawBody(req);
    const payload = rawBody.toString('utf8');

    // Fail closed — require webhook secret in production
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
    if (!webhookSecret) {
      if (process.env.NODE_ENV !== 'development') {
        console.error('RESEND_WEBHOOK_SECRET not set in production — rejecting request');
        return res.status(500).json({ error: 'Webhook secret not configured' });
      }
      console.warn('RESEND_WEBHOOK_SECRET not set — skipping verification (dev only)');
    } else {
      const wh = new Webhook(webhookSecret);
      try {
        wh.verify(payload, {
          'svix-id': req.headers['svix-id'],
          'svix-timestamp': req.headers['svix-timestamp'],
          'svix-signature': req.headers['svix-signature'],
        });
      } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const event = JSON.parse(payload);

    // Only process email.received events
    if (event.type !== 'email.received') {
      return res.status(200).json({ message: 'Ignored event type: ' + event.type });
    }

    const emailData = event.data;
    const emailId = emailData.email_id || emailData.id;

    if (!emailId) {
      return res.status(400).json({ error: 'Missing email ID' });
    }

    // Fetch full email content (body, headers) from Resend API
    // Webhook payload only contains metadata, not the email body
    // Retry with delay because the email body may not be immediately available
    let fullEmail = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) {
        await new Promise(r => setTimeout(r, 2000)); // wait 2s between retries
      }
      fullEmail = await fetchEmailContent(emailId);
      if (fullEmail && (fullEmail.text || fullEmail.html)) {
        console.log(`Fetched email body on attempt ${attempt}`);
        break;
      }
      console.log(`Attempt ${attempt}: email body not available yet`);
    }

    const text = fullEmail?.text || emailData.text || '';
    const html = fullEmail?.html || emailData.html || '';
    const messageId = fullEmail?.message_id || emailData.message_id || '';
    const references = fullEmail?.references || emailData.references || '';

    // Upload inbound attachments to Firebase Storage (if any)
    const attachments = [];
    const attSource = fullEmail?.attachments || emailData.attachments || [];
    if (attSource.length > 0) {
      const bucket = admin.storage().bucket();

      for (const att of attSource) {
        const safeName = (att.filename || 'attachment').replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = `inbound-attachments/${emailId}/${safeName}`;
        const file = bucket.file(storagePath);

        if (att.content) {
          const buffer = Buffer.from(att.content, 'base64');
          await file.save(buffer, {
            metadata: { contentType: att.content_type || 'application/octet-stream' },
          });
          await file.makePublic();

          attachments.push({
            filename: safeName,
            contentType: att.content_type || 'application/octet-stream',
            size: att.size || buffer.length,
            storagePath,
            storageUrl: `https://storage.googleapis.com/${bucket.name}/${storagePath}`,
          });
        }
      }
    }

    // Check if doc exists to avoid wiping replies on re-delivery
    const existing = await db.collection('inbound-emails').doc(emailId).get();
    if (existing.exists) {
      await db.collection('inbound-emails').doc(emailId).update({
        from: emailData.from || '',
        to: emailData.to || [],
        subject: emailData.subject || '(no subject)',
        text,
        html,
        messageId,
        references,
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        attachments,
      });
    } else {
      await db.collection('inbound-emails').doc(emailId).set({
        from: emailData.from || '',
        to: emailData.to || [],
        subject: emailData.subject || '(no subject)',
        text,
        html,
        messageId,
        references,
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
        attachments,
        replies: [],
      });
    }

    console.log(`Stored inbound email: ${emailId} from ${emailData.from}`);
    return res.status(200).json({ message: 'Email stored', emailId });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Failed to process webhook' });
  }
}
