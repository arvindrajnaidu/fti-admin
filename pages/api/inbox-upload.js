import { admin } from '../../lib/firebase';
import { requireAuth } from '../../lib/withAuth';
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];

// Allow up to 10MB for image uploads
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
    const { filename, contentType, content } = req.body;

    if (!filename || !contentType || !content) {
      return res.status(400).json({ error: 'Missing filename, contentType, or content' });
    }

    // Fix #8: Validate content type server-side
    if (!ALLOWED_TYPES.includes(contentType)) {
      return res.status(400).json({ error: 'File type not allowed. Accepted: JPEG, PNG, GIF, WebP, PDF' });
    }

    // Sanitize filename
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const bucket = admin.storage().bucket();
    const storagePath = `inbox-reply-attachments/${Date.now()}-${safeName}`;
    const file = bucket.file(storagePath);

    const buffer = Buffer.from(content, 'base64');
    await file.save(buffer, {
      metadata: { contentType },
    });
    await file.makePublic();

    const storageUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

    return res.status(200).json({
      filename: safeName,
      storageUrl,
      content, // Pass back so reply API can send to Resend without re-fetching
    });
  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ error: 'Failed to upload file', message: error.message });
  }
}
