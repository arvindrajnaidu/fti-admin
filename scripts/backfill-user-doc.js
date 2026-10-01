// Backfill missing user-doc fields from Firebase Auth records.
//
// Pattern surfaced via the keonwook park investigation (2026-06-04):
// ~1% of user docs are missing email + displayName because the
// createUserDocument Cloud Function (fnfoodtoindia/functions/index.js
// onCreate trigger) silently failed for some auth events. And 100% of
// user docs are missing createdAt because no writer ever sets it.
//
// What this script does, per user:
//   1. Read the user doc.
//   2. If any of email / displayName / name / id / uid / createdAt are
//      MISSING (not just falsy - undefined or empty), fetch the auth
//      record via admin.auth().getUser(uid).
//   3. Compute the patch (only fields that were missing get touched -
//      we don't overwrite existing values).
//   4. Dry-run by default: print what WOULD change.
//      With --apply: write via { merge: true }.
//
// Modes:
//   node scripts/backfill-user-doc.js                         # dry-run, all users
//   node scripts/backfill-user-doc.js --apply                 # write, all users
//   node scripts/backfill-user-doc.js --uid <UID>             # single user, dry-run
//   node scripts/backfill-user-doc.js --uid <UID> --apply     # single user, apply
//   node scripts/backfill-user-doc.js --limit 50              # cap scanned users
//
// Safety: doesn't overwrite existing fields - only writes ones currently
// missing. Skips users whose Firebase Auth record is gone (deleted
// accounts).

const fs = require('fs');
const path = require('path');

try {
  const envFile = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
  envFile.split('\n').forEach((line) => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) return;
    let val = m[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    process.env[m[1].trim()] = val;
  });
} catch (e) {
  console.error('Could not read .env.local:', e.message);
  process.exit(1);
}

const admin = require('firebase-admin');
const { db } = require('../lib/firebase');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) { out[key] = true; continue; }
    out[key] = next;
    i += 1;
  }
  return out;
}

// Build the patch for a single user. Returns null if nothing to backfill.
// Skips userRecord==null (deleted auth) - those return null too.
function buildPatch(userDoc, userRecord) {
  if (!userRecord) return null;
  const cur = userDoc || {};
  const patch = {};

  // Only backfill fields the doc is MISSING. We don't overwrite
  // existing values - if email is already set, leave it.
  if (cur.email === undefined || cur.email === '' || cur.email === null) {
    if (userRecord.email) patch.email = userRecord.email;
  }
  if (cur.displayName === undefined || cur.displayName === '' || cur.displayName === null) {
    if (userRecord.displayName) patch.displayName = userRecord.displayName;
  }
  if (cur.name === undefined || cur.name === '' || cur.name === null) {
    if (userRecord.displayName) patch.name = userRecord.displayName;
  }
  if (cur.id === undefined || cur.id === '' || cur.id === null) {
    patch.id = userRecord.uid;
  }
  if (cur.uid === undefined || cur.uid === '' || cur.uid === null) {
    patch.uid = userRecord.uid;
  }
  if (cur.createdAt === undefined || cur.createdAt === '' || cur.createdAt === null) {
    if (userRecord.metadata?.creationTime) {
      const ts = new Date(userRecord.metadata.creationTime).getTime();
      if (!isNaN(ts)) patch.createdAt = ts;
    }
  }
  if (cur.providerId === undefined || cur.providerId === '' || cur.providerId === null) {
    const p = (userRecord.providerData || [])[0]?.providerId;
    if (p) patch.providerId = p;
  }

  if (Object.keys(patch).length === 0) return null;
  return patch;
}

async function processOne(uid, { apply }) {
  const docRef = db.collection('users').doc(uid);
  const snap = await docRef.get();
  if (!snap.exists) {
    return { uid, status: 'no-user-doc' };
  }
  const cur = snap.data();

  // Don't waste an auth.getUser() call if the doc has email+displayName+
  // createdAt+providerId already. Common case: ~99% of users.
  const allFieldsPresent =
    cur.email && cur.displayName && cur.name && cur.id && cur.uid &&
    cur.createdAt && cur.providerId;
  if (allFieldsPresent) {
    return { uid, status: 'already-complete' };
  }

  let userRecord = null;
  try {
    userRecord = await admin.auth().getUser(uid);
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      return { uid, status: 'auth-deleted' };
    }
    return { uid, status: 'auth-error', error: e.message };
  }

  const patch = buildPatch(cur, userRecord);
  if (!patch) return { uid, status: 'nothing-to-patch' };

  if (apply) {
    await docRef.set(patch, { merge: true });
    return { uid, status: 'applied', patch, currentEmail: userRecord.email };
  }
  return { uid, status: 'would-apply', patch, currentEmail: userRecord.email };
}

function printDecision(result) {
  if (['already-complete', 'nothing-to-patch'].includes(result.status)) return;
  const fields = result.patch ? Object.keys(result.patch).sort().join(', ') : '';
  const email = result.currentEmail || '(no auth email)';
  const tag = result.status === 'applied' ? '[APPLIED]'
    : result.status === 'would-apply' ? '[would patch]'
    : result.status === 'auth-deleted' ? '[skip - auth gone]'
    : result.status === 'auth-error' ? '[skip - auth error]'
    : `[${result.status}]`;
  console.log(`  ${tag.padEnd(22)} uid=${result.uid}  email=${email}  fields=${fields}${result.error ? ` err=${result.error}` : ''}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apply = Boolean(args.apply);
  const limit = args.limit ? parseInt(args.limit, 10) : null;
  const singleUid = args.uid;

  console.log(`Backfill user-doc fields on ${process.env.FIREBASE_ENV}`);
  console.log(`Mode: ${apply ? 'APPLY (writes)' : 'DRY-RUN (no writes)'}`);
  if (singleUid) console.log(`Single uid: ${singleUid}`);
  if (limit) console.log(`Limit: ${limit}`);
  console.log('');

  const stats = {
    scanned: 0,
    'already-complete': 0,
    'auth-deleted': 0,
    'auth-error': 0,
    'no-user-doc': 0,
    'nothing-to-patch': 0,
    'would-apply': 0,
    applied: 0,
  };
  const examples = [];

  let userDocs;
  if (singleUid) {
    userDocs = [{ id: singleUid }];
  } else {
    const usersSnap = await db.collection('users').get();
    userDocs = usersSnap.docs;
    if (limit) userDocs = userDocs.slice(0, limit);
    console.log(`Scanning ${userDocs.length} user docs...\n`);
  }

  const batchSize = 25; // gentle on auth API
  for (let i = 0; i < userDocs.length; i += batchSize) {
    const batch = userDocs.slice(i, i + batchSize);
    const results = await Promise.all(batch.map((d) => processOne(d.id, { apply })));
    results.forEach((r) => {
      stats.scanned += 1;
      stats[r.status] = (stats[r.status] || 0) + 1;
      if (['would-apply', 'applied', 'auth-deleted', 'auth-error'].includes(r.status)) {
        examples.push(r);
        printDecision(r);
      }
    });
    if (i + batchSize < userDocs.length && stats.scanned % 250 === 0) {
      console.log(`  ...progress: ${stats.scanned}/${userDocs.length}`);
    }
  }

  console.log('');
  console.log('=== summary ===');
  console.log(`scanned:           ${stats.scanned}`);
  console.log(`already-complete:  ${stats['already-complete']}`);
  console.log(`nothing-to-patch:  ${stats['nothing-to-patch']}`);
  console.log(`auth-deleted:      ${stats['auth-deleted']}`);
  console.log(`auth-error:        ${stats['auth-error']}`);
  console.log(`no-user-doc:       ${stats['no-user-doc']}`);
  if (apply) {
    console.log(`APPLIED:           ${stats.applied}`);
  } else {
    console.log(`WOULD APPLY:       ${stats['would-apply']}`);
    console.log('');
    console.log('Re-run with --apply to write the patches.');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('backfill failed:', err);
  process.exit(1);
});
