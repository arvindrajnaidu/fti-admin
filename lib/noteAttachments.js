// Shared rules for internal-note attachments. Used by the upload route
// (order-note-upload) and the notes route (order-notes) so the allow-list,
// size caps, and storage-path convention are defined in exactly one place.
//
// Attachments are ops-only, private at rest in GCS. Images render inline in
// the order modal; every other allowed type is offered as a download.

export const ALLOWED_COLLECTIONS = new Set(['orders', 'grocery_orders']);

// `collection` defaults to "orders" (food). Whitelisted so a stray query
// string can't aim writes/reads at an arbitrary subcollection.
export function resolveCollection(value) {
  const c = String(value || 'orders');
  if (!ALLOWED_COLLECTIONS.has(c)) return null;
  return c;
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file
export const MAX_FILES_PER_NOTE = 10;

// Reject a client-supplied Firestore doc id that isn't a single, safe segment.
// The Admin SDK's .doc(path) treats slashes as path separators AND bypasses
// security rules, so an unchecked userId/orderId/noteId could aim a read/write
// at an arbitrary document elsewhere under the tree. Real ids here are Firebase
// uids and Firestore auto-ids — never slashed — so this can't reject a valid one.
export function isSafeId(v) {
  if (typeof v !== 'string') return false;
  if (!v || v.length > 1500) return false;
  if (v === '.' || v === '..') return false;
  if (v.includes('/')) return false;
  if (/^__.*__$/.test(v)) return false; // Firestore reserves __*__ ids
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(v)) return false; // no control chars
  return true;
}

// Image types we accept for UPLOAD. HEIC/HEIF are allowed (iPhone photos) but
// are NOT browser-renderable — see RENDERABLE_IMAGE_MIME / isImage below.
export const IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
]);

// Subset that actually decodes in Chrome/Firefox, i.e. can be shown inline via
// <img>. HEIC/HEIF are excluded on purpose so they fall back to a download chip
// instead of a permanently broken thumbnail.
export const RENDERABLE_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

// Everything else allowed — rendered as a download chip (PDF, spreadsheets,
// docs, plain text, archives). Ops pastes screenshots (images) and the odd
// receipt/sheet/zip from a conversation.
export const DOC_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.ms-excel', // xls
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/msword', // doc
  'text/plain',
  'application/zip',
  'application/x-zip-compressed',
]);

// Whether an attachment should render inline as an image. Only browser-decodable
// formats — HEIC/HEIF are uploadable but shown as download chips.
export function isImage(contentType) {
  return RENDERABLE_IMAGE_MIME.has(String(contentType));
}

export function isAllowedType(contentType) {
  const ct = String(contentType);
  return IMAGE_MIME.has(ct) || DOC_MIME.has(ct);
}

// Keep filenames filesystem/URL-safe and bounded.
export function sanitizeName(name) {
  const clean = String(name || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120);
  return clean || 'file';
}

// All attachments for an order live under this prefix. The notes route uses
// it to reject any storagePath a client tries to attach that doesn't belong
// to this exact order — the signed upload URL is not enough on its own.
export function attachmentPrefix(userId, orderId) {
  return `order-note-attachments/${String(userId)}/${String(orderId)}/`;
}
