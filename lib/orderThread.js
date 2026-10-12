// Mirror of foodtoindia/lib/emailThread.js for the two things the admin
// sends about an order: the one conversation subject, and the reply address
// that names the order (lowercase base32 of the id, so any casing on the way
// back decodes to the same id). Keep in step with the main app.
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
const safeId = (v) => String(v || '').replace(/[^A-Za-z0-9_-]/g, '');

function base32Encode(text) {
  const bytes = Buffer.from(text, 'utf8');
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function orderConversationSubject(orderId, restaurantName) {
  const id = safeId(orderId);
  const rest = String(restaurantName || '').trim();
  return `Re: Order #${id}${rest && rest !== 'N/A' ? ` - ${rest}` : ''}`;
}

export function orderReplyTo(orderId, base = 'support@foodtoindia.com') {
  const id = safeId(orderId);
  const at = base.indexOf('@');
  if (!id || at < 1) return base;
  return `${base.slice(0, at)}+${base32Encode(id)}${base.slice(at)}`;
}
