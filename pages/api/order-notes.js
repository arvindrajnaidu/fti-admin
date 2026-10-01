import { db, admin } from '../../lib/firebase';
import { requireAuth } from '../../lib/withAuth';
import { buildOrderActivity, toMs } from '../../lib/orderActivity';
import {
  resolveCollection,
  isAllowedType,
  isImage,
  isSafeId,
  sanitizeName,
  attachmentPrefix,
  MAX_FILES_PER_NOTE,
} from '../../lib/noteAttachments';

// Internal order notes — an ops-only, append-only trail per order.
//
// GET    ?userId=&orderId=&collection=  → merged feed: typed notes (with any
//          attachments, each given a short-lived signed read URL) from the
//          users/{uid}/<collection>/{id}/internalNotes subcollection plus
//          synthesized status events from the order doc, newest first.
// POST   { userId, orderId, text, collection, attachments? } → append one note.
//          A note needs text OR at least one attachment.
// DELETE { userId, orderId, collection, noteId, storagePath } → remove one
//          attachment from a note and delete the underlying GCS object. Note
//          text stays immutable — only attachments can be pulled.
//
// `collection` defaults to "orders" (food); grocery passes "grocery_orders".

const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

// Mint a short-lived signed read URL for a private attachment. Returns null
// (not throw) so one bad path can't blank the whole notes feed.
async function signRead(bucket, storagePath) {
  try {
    const [url] = await bucket.file(storagePath).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + SIGNED_URL_TTL_MS,
    });
    return url;
  } catch (err) {
    console.error('sign read failed for', storagePath, err.message);
    return null;
  }
}

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (req.method === 'GET') {
    const { userId, orderId, collection } = req.query;
    if (!isSafeId(userId) || !isSafeId(orderId)) {
      return res.status(400).json({ error: 'Invalid userId or orderId' });
    }
    const coll = resolveCollection(collection);
    if (!coll) return res.status(400).json({ error: 'Invalid collection' });
    try {
      const bucket = admin.storage().bucket();
      const orderRef = db
        .collection('users').doc(String(userId))
        .collection(coll).doc(String(orderId));
      const [orderSnap, notesSnap] = await Promise.all([
        orderRef.get(),
        orderRef.collection('internalNotes').orderBy('createdAt', 'desc').get(),
      ]);
      if (!orderSnap.exists) {
        return res.status(404).json({ error: 'Order not found' });
      }
      const notes = await Promise.all(
        notesSnap.docs.map(async (d) => {
          const n = d.data();
          const rawAtt = Array.isArray(n.attachments) ? n.attachments : [];
          const attachments = await Promise.all(
            rawAtt.map(async (a) => ({
              storagePath: a.storagePath,
              filename: a.filename,
              contentType: a.contentType,
              size: a.size ?? null,
              isImage: !!a.isImage,
              url: await signRead(bucket, a.storagePath),
            })),
          );
          return {
            id: d.id,
            type: 'note',
            kind: 'note',
            text: n.text || '',
            authorName: n.authorName || 'Ops',
            authorId: n.authorId || '',
            ts: toMs(n.createdAt),
            attachments,
          };
        }),
      );
      const withTs = notes.filter((n) => n.ts);
      const events = buildOrderActivity(orderSnap.data()).map((e) => ({ ...e, type: 'event' }));
      const items = [...withTs, ...events].sort((a, b) => b.ts - a.ts);
      return res.status(200).json({ items });
    } catch (err) {
      console.error('order-notes GET failed:', err);
      return res.status(500).json({ error: 'Failed to load order notes' });
    }
  }

  if (req.method === 'POST') {
    const { userId, orderId, text, collection } = req.body || {};
    if (!isSafeId(userId) || !isSafeId(orderId)) {
      return res.status(400).json({ error: 'Invalid userId or orderId' });
    }
    const coll = resolveCollection(collection);
    if (!coll) return res.status(400).json({ error: 'Invalid collection' });

    // Validate attachments. Each storagePath MUST live under this order's
    // prefix — a signed upload URL alone doesn't prove the client is allowed
    // to pin an arbitrary object onto this note.
    const rawAtt = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
    if (rawAtt.length > MAX_FILES_PER_NOTE) {
      return res.status(400).json({ error: `Too many attachments (max ${MAX_FILES_PER_NOTE})` });
    }
    const prefix = attachmentPrefix(userId, orderId);
    const attachments = [];
    for (const a of rawAtt) {
      const storagePath = String(a?.storagePath || '');
      if (!storagePath.startsWith(prefix)) {
        return res.status(400).json({ error: 'Invalid attachment path' });
      }
      if (!isAllowedType(a?.contentType)) {
        return res.status(400).json({ error: 'Invalid attachment type' });
      }
      const numSize = Number(a?.size);
      attachments.push({
        storagePath,
        filename: sanitizeName(a?.filename),
        contentType: String(a.contentType),
        size: Number.isFinite(numSize) ? numSize : null,
        isImage: isImage(a.contentType),
      });
    }

    const clean = String(text || '').trim();
    if (!clean && attachments.length === 0) {
      return res.status(400).json({ error: 'Note text or an attachment is required' });
    }
    if (clean.length > 2000) {
      return res.status(400).json({ error: 'Note is too long (2000 char max)' });
    }

    try {
      const author = session.user?.username || 'Ops';
      const ref = await db
        .collection('users').doc(String(userId))
        .collection(coll).doc(String(orderId))
        .collection('internalNotes')
        .add({
          kind: 'note',
          text: clean,
          authorName: author,
          authorId: author,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          ...(attachments.length ? { attachments } : {}),
        });
      return res.status(200).json({
        ok: true,
        note: {
          id: ref.id,
          type: 'note',
          kind: 'note',
          text: clean,
          authorName: author,
          authorId: author,
          ts: Date.now(),
          attachmentCount: attachments.length,
        },
      });
    } catch (err) {
      console.error('order-notes POST failed:', err);
      return res.status(500).json({ error: 'Failed to save note' });
    }
  }

  if (req.method === 'DELETE') {
    const { userId, orderId, collection, noteId, storagePath } = req.body || {};
    if (!isSafeId(userId) || !isSafeId(orderId) || !isSafeId(noteId)) {
      return res.status(400).json({ error: 'Invalid userId, orderId or noteId' });
    }
    if (!storagePath) {
      return res.status(400).json({ error: 'storagePath is required' });
    }
    const coll = resolveCollection(collection);
    if (!coll) return res.status(400).json({ error: 'Invalid collection' });
    if (!String(storagePath).startsWith(attachmentPrefix(userId, orderId))) {
      return res.status(400).json({ error: 'Invalid attachment path' });
    }
    try {
      const noteRef = db
        .collection('users').doc(String(userId))
        .collection(coll).doc(String(orderId))
        .collection('internalNotes').doc(String(noteId));
      const snap = await noteRef.get();
      if (!snap.exists) return res.status(404).json({ error: 'Note not found' });

      const current = Array.isArray(snap.data().attachments) ? snap.data().attachments : [];
      const remaining = current.filter((a) => a.storagePath !== storagePath);
      if (remaining.length === current.length) {
        return res.status(404).json({ error: 'Attachment not found on this note' });
      }
      await noteRef.update({ attachments: remaining });

      // Best-effort object delete — a missing object shouldn't fail the request.
      try {
        await admin.storage().bucket().file(String(storagePath)).delete();
      } catch (err) {
        if (err.code !== 404) console.error('attachment object delete failed:', err.message);
      }
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('order-notes DELETE failed:', err);
      return res.status(500).json({ error: 'Failed to remove attachment' });
    }
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
