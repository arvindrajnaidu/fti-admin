// Pull the latest received emails from Resend into `inbound-emails`.
//
// The Inbox used to depend entirely on Resend's webhook pushing each email to
// /api/webhooks/resend-inbound. When that delivery fails - a rejected
// signature, a disabled endpoint, a bad deploy - emails silently never appear,
// and nobody notices until a customer does. Resend keeps every received email,
// so the Inbox now pulls the newest ones each time it is opened and stores any
// it has not seen, in the exact shape the webhook writes. The webhook becomes
// a fast path, not a dependency.
//
// Needs a FULL-access Resend key: the app's sending-only key is refused
// ("restricted to only send emails"). RESEND_INBOUND_API_KEY, falling back to
// RESEND_API_KEY, mirrors the main app.

const DEFAULT_LIMIT = 50;

function inboundResendKey() {
  return process.env.RESEND_INBOUND_API_KEY || process.env.RESEND_API_KEY || null;
}

function docFromResend(item, full) {
  return {
    from: item.from || '',
    to: item.to || [],
    subject: item.subject || '(no subject)',
    text: full?.text || '',
    html: full?.html || '',
    messageId: full?.message_id || item.message_id || '',
    references: full?.headers?.references || full?.headers?.References || '',
    // The time Resend received it, so a backfilled email sorts where it
    // belongs rather than at the moment the Inbox happened to be opened.
    receivedAt: item.created_at ? new Date(item.created_at) : new Date(),
    read: false,
    attachments: (full?.attachments || []).map((a) => ({
      filename: a.filename || 'attachment',
      contentType: a.content_type || 'application/octet-stream',
      size: a.size || 0,
      resendAttachmentId: a.id,
    })),
    replies: [],
    source: 'pull',
  };
}

// Never throws. Returns { ok, seen, added, error? }.
async function syncReceivedEmails({ db, resend, limit = DEFAULT_LIMIT, log = console.log }) {
  if (!db || !resend) return { ok: false, seen: 0, added: 0, error: 'not_configured' };
  let listed;
  try {
    listed = await resend.emails.receiving.list({ limit });
  } catch (e) {
    return { ok: false, seen: 0, added: 0, error: e?.message || String(e) };
  }
  if (listed?.error) return { ok: false, seen: 0, added: 0, error: listed.error.message || 'list_failed' };

  const items = listed?.data?.data || [];
  let added = 0;
  for (const item of items) {
    if (!item?.id) continue;
    const ref = db.collection('inbound-emails').doc(item.id);
    const snap = await ref.get();
    if (snap.exists) continue;

    let full = null;
    try {
      const got = await resend.emails.receiving.get(item.id);
      full = got?.data || null;
    } catch (e) {
      log(`[inbox-sync] body fetch failed for ${item.id}: ${e?.message || e}`);
    }
    await ref.set(docFromResend(item, full));
    added += 1;
  }
  if (added) log(`[inbox-sync] pulled ${added} new email(s) of ${items.length} listed`);
  return { ok: true, seen: items.length, added };
}

module.exports = { syncReceivedEmails, docFromResend, inboundResendKey, DEFAULT_LIMIT };
