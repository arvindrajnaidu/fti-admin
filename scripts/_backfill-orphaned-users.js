/*
 * _backfill-orphaned-users.js — repair users/{uid} docs that are missing identity.
 *
 * Root cause: the Auth onCreate Cloud Function (fnfoodtoindia/functions/index.js)
 * is fire-and-forget with no retry, so transient failures leave a user with no
 * users/{uid} doc (or an email-less stub written later by orders.js:947).
 *
 * This script re-detects the affected set (same logic as _check-orphaned-users.js)
 * and repairs the core identity fields from Firebase Auth (the source of truth),
 * falling back to the user's own order senderEmail/senderName.
 *
 * SAFE BY DEFAULT: dry-run. It only prints what it would write.
 *   Dry run : NODE_OPTIONS='--openssl-legacy-provider' node scripts/_backfill-orphaned-users.js
 *   Commit  : NODE_OPTIONS='--openssl-legacy-provider' node scripts/_backfill-orphaned-users.js --commit
 *
 * Writes are merge-only and scoped to non-guest docs that are missing email, so
 * existing fields (orderCount, referralCredits, stripeCustomerId, ...) are never
 * clobbered. Guest identity deliberately stays namespaced under guestContact.
 */

const fs = require('fs');
const path = require('path');

try {
  const envFile = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
  envFile.split('\n').forEach((line) => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) return;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[m[1].trim()] = val;
  });
} catch (e) {
  console.error('Failed to load .env.local:', e.message);
  process.exit(1);
}

const { admin, db } = require('../lib/firebase');
const COMMIT = process.argv.includes('--commit');

function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (v.toDate) return v.toDate().getTime();
  if (v instanceof Date) return v.getTime();
  return null;
}
// order senderName carries a "[Risk Score: N, Country XX]" suffix — strip it.
function cleanName(n) {
  if (!n) return null;
  return String(n).split(' [Risk Score')[0].replace(/\s+/g, ' ').trim() || null;
}

(async () => {
  console.log(COMMIT ? '*** COMMIT MODE — will write to prod ***' : 'DRY RUN — no writes (pass --commit to write)');
  const refs = await db.collection('users').listDocuments();

  const targets = [];
  const batch = 40;
  for (let i = 0; i < refs.length; i += batch) {
    await Promise.all(refs.slice(i, i + batch).map(async (ref) => {
      const [snap, oSnap] = await Promise.all([ref.get(), ref.collection('orders').get()]);
      if (oSnap.size === 0) return;                         // only users with orders
      if (snap.exists && snap.data().isGuest === true) return; // intentional guest identity shape
      if (snap.exists && snap.data().email) return;         // already healthy
      // identity from the user's own orders as fallback
      let email = '', name = '', first = null;
      oSnap.forEach((d) => {
        const x = d.data();
        if (!email && x.senderEmail) email = String(x.senderEmail).trim();
        if (!name && x.senderName) name = cleanName(x.senderName);
        const ms = toMs(x.createdAt);
        if (ms != null && (first == null || ms < first)) first = ms;
      });
      targets.push({
        ref,
        uid: ref.id,
        exists: snap.exists,
        current: snap.exists ? snap.data() : {},
        orderEmail: email,
        orderName: name,
        first,
      });
    }));
  }

  console.log(`Affected docs to repair: ${targets.length}\n`);
  let wrote = 0;
  for (const t of targets) {
    // Prefer Firebase Auth (the same source the onCreate function used).
    let authEmail = null, authName = null, authCreatedAt = null, authMissing = false;
    try {
      const u = await admin.auth().getUser(t.uid);
      authEmail = u.email || null;
      authName = u.displayName || null;
      const authCreatedMs = u.metadata?.creationTime
        ? new Date(u.metadata.creationTime).getTime()
        : NaN;
      if (!Number.isNaN(authCreatedMs)) authCreatedAt = authCreatedMs;
    } catch (e) {
      authMissing = true; // Auth user deleted/not found — fall back to order data
    }

    const email = authEmail || t.orderEmail || null;
    const displayName = authName || t.orderName || null;
    if (!email) { console.log(`SKIP  ${t.uid}  (no email in Auth or orders)`); continue; }

    const payload = {
      id: t.uid,
      uid: t.uid,
      email,
      backfilledAt: Date.now(),
      backfillSource: '_backfill-orphaned-users',
    };
    if (!t.current.displayName && displayName) payload.displayName = displayName;
    if (!t.current.name && displayName) payload.name = displayName;
    const createdAt = authCreatedAt || t.first;
    if (!t.current.createdAt && createdAt) payload.createdAt = createdAt;

    const src = authMissing ? 'order' : (authEmail ? 'auth' : 'order');
    console.log(`${COMMIT ? 'WRITE' : 'PLAN '} ${t.exists ? 'stub ' : 'NEW  '} ${t.uid}  email=${email}  name=${displayName || '-'}  src=${src}`);

    if (COMMIT) {
      await t.ref.set(payload, { merge: true });
      wrote++;
    }
  }

  console.log(`\n${COMMIT ? `Wrote ${wrote} docs.` : `Would write ${targets.length} docs. Re-run with --commit to apply.`}`);
  console.log('After committing, re-run _check-orphaned-users.js — affected should be 0.');
  process.exit(0);
})().catch((e) => { console.error('Error:', e); process.exit(1); });
