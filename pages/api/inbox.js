import { db } from '../../lib/firebase';
import { requireAuth } from '../../lib/withAuth';
// Lazy-fetch email body from Resend API when webhook didn't store it.
// More reliable than fetching in the webhook (no timing race, no Vercel quirks).
//
// Returns a structured result so callers can distinguish failure modes
// instead of treating every miss as "no body to render":
//   { ok: true,  content }                          — fetched + cached
//   { ok: false, code: 'NO_API_KEY' }               — env var missing on this runtime
//   { ok: false, code: 'EMPTY_RESPONSE' }           — Resend returned no text/html
//   { ok: false, code: 'FETCH_THREW', message }     — Resend or Firestore call threw
async function fetchAndCacheEmailBody(emailId) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.error('Lazy-fetch skipped: RESEND_API_KEY not set in this runtime');
    return { ok: false, code: 'NO_API_KEY' };
  }

  try {
    const { Resend } = require('resend');
    const resend = new Resend(RESEND_API_KEY);
    const response = await resend.emails.receiving.get(emailId);
    const emailContent = response?.data || response;

    if (!emailContent || (!emailContent.text && !emailContent.html)) {
      return { ok: false, code: 'EMPTY_RESPONSE' };
    }

    // Cache in Firestore so we don't fetch again
    await db.collection('inbound-emails').doc(emailId).update({
      text: emailContent.text || '',
      html: emailContent.html || '',
      messageId: emailContent.message_id || '',
    });
    return { ok: true, content: emailContent };
  } catch (err) {
    console.error('Failed to lazy-fetch email body:', err.message);
    return { ok: false, code: 'FETCH_THREW', message: err.message };
  }
}

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (!db) {
    return res.status(500).json({ error: 'Firebase not initialized' });
  }

  try {
    switch (req.method) {
      case 'GET':
        return await handleGet(req, res);
      case 'PATCH':
        return await handlePatch(req, res);
      case 'DELETE':
        return await handleDelete(req, res);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Inbox API error:', error);
    return res.status(500).json({ error: 'Failed to process request', message: error.message });
  }
}

async function handleGet(req, res) {
  const { id, cursor } = req.query;

  // Single email fetch
  if (id) {
    const doc = await db.collection('inbound-emails').doc(id).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Email not found' });
    }

    // Auto-mark as read
    if (!doc.data().read) {
      await db.collection('inbound-emails').doc(id).update({ read: true });
    }

    let data = doc.data();
    const wasUnread = !data.read;

    // Lazy-fetch body if webhook didn't store it. On failure, propagate the
    // reason in the response under `bodyFetchError` so silent misses (missing
    // env var, throws inside Resend SDK, etc.) are visible to callers / DevTools.
    let bodyFetchError = null;
    if (!data.text && !data.html) {
      const result = await fetchAndCacheEmailBody(id);
      if (result.ok) {
        data.text = result.content.text || '';
        data.html = result.content.html || '';
        data.messageId = result.content.message_id || data.messageId || '';
      } else {
        bodyFetchError = { code: result.code };
        if (result.message) bodyFetchError.message = result.message;
      }
    }

    return res.status(200).json({
      email: {
        id: doc.id,
        ...data,
        receivedAt: data.receivedAt?.toDate?.()?.toISOString() || data.receivedAt,
        replies: (data.replies || []).map(r => ({
          ...r,
          repliedAt: r.repliedAt?.toDate?.()?.toISOString() || r.repliedAt,
        })),
        ...(bodyFetchError ? { bodyFetchError } : {}),
      },
      wasUnread,
    });
  }

  // List emails with pagination
  let query = db.collection('inbound-emails')
    .orderBy('receivedAt', 'desc')
    .limit(30);

  if (cursor) {
    const cursorDoc = await db.collection('inbound-emails').doc(cursor).get();
    if (cursorDoc.exists) {
      query = query.startAfter(cursorDoc);
    }
  }

  const snapshot = await query.get();
  const emails = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      from: data.from,
      subject: data.subject,
      read: data.read,
      receivedAt: data.receivedAt?.toDate?.()?.toISOString() || data.receivedAt,
      hasAttachments: (data.attachments || []).length > 0,
      replyCount: (data.replies || []).length,
    };
  });

  // Get unread count
  const unreadSnapshot = await db.collection('inbound-emails')
    .where('read', '==', false)
    .get();

  return res.status(200).json({
    emails,
    unreadCount: unreadSnapshot.size,
    nextCursor: emails.length === 30 ? emails[emails.length - 1].id : null,
  });
}

async function handlePatch(req, res) {
  const { id, read } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'Missing email id' });
  }

  // Default to marking read when `read` is omitted (legacy callers).
  const readValue = read === undefined ? true : !!read;
  await db.collection('inbound-emails').doc(id).update({ read: readValue });
  return res.status(200).json({ success: true, read: readValue });
}

async function handleDelete(req, res) {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'Missing email id' });
  }

  const doc = await db.collection('inbound-emails').doc(id).get();
  if (!doc.exists) {
    return res.status(404).json({ error: 'Email not found' });
  }

  await db.collection('inbound-emails').doc(id).delete();
  return res.status(200).json({ success: true });
}
