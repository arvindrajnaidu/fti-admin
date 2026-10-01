import crypto from 'crypto';
import { admin } from '../../lib/firebase';
import { requireAuth } from '../../lib/withAuth';
import {
  resolveCollection,
  isAllowedType,
  isSafeId,
  sanitizeName,
  attachmentPrefix,
  MAX_FILE_BYTES,
} from '../../lib/noteAttachments';

// Mints a short-lived V4 signed PUT URL so the browser uploads an internal-note
// attachment DIRECTLY to Google Cloud Storage — bypassing Vercel's ~4.5 MB
// serverless body limit, which real phone photos routinely exceed.
//
// POST { userId, orderId, collection, filename, contentType, size }
//   → { uploadUrl, storagePath, filename, contentType }
//
// The client must PUT to uploadUrl with the SAME Content-Type header — the
// signed URL is bound to contentType. The file lands private; it is only
// recorded on a note (and later readable) once order-notes POST is called
// with the returned storagePath.
export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, orderId, collection, filename, contentType, size } = req.body || {};
  if (!isSafeId(userId) || !isSafeId(orderId)) {
    return res.status(400).json({ error: 'Invalid userId or orderId' });
  }
  const coll = resolveCollection(collection);
  if (!coll) return res.status(400).json({ error: 'Invalid collection' });

  if (!contentType || !isAllowedType(contentType)) {
    return res.status(400).json({ error: 'File type not allowed' });
  }
  const numSize = Number(size);
  if (Number.isFinite(numSize) && numSize > MAX_FILE_BYTES) {
    return res.status(400).json({ error: 'File too large (10 MB max)' });
  }

  try {
    const safeName = sanitizeName(filename);
    const storagePath =
      `${attachmentPrefix(userId, orderId)}${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;
    const file = admin.storage().bucket().file(storagePath);

    const [uploadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 15 * 60 * 1000,
      contentType,
    });

    return res.status(200).json({ uploadUrl, storagePath, filename: safeName, contentType });
  } catch (err) {
    console.error('order-note-upload failed:', err);
    return res.status(500).json({ error: 'Failed to create upload URL' });
  }
}
