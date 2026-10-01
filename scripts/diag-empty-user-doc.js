// Diagnostic: investigate users whose Firestore user doc has missing
// fields (e.g., empty email/displayName) even though they have orders.
// Pattern surfaced via keonwook park (uid kIiUBFt6G5OXtYjAhXNREnKTN9C2).
//
// What this script does:
//   1. Inspect the specific user(s) passed in via --uid flag, listing
//      EVERY top-level field with raw value + type.
//   2. Cross-reference Firebase Auth: does an Auth record exist for the
//      uid? What does it contain (email, displayName, providerData,
//      metadata.creationTime)?
//   3. Scan a sample of OTHER users to count how widespread the empty-
//      user-doc pattern is (do most have email populated? what fraction?).
//   4. Print the user's recent orders so we can correlate signup-time
//      with first-order-time.
//
// Run: NODE_OPTIONS='--openssl-legacy-provider' node scripts/diag-empty-user-doc.js --uid <UID> [--scan-sample 200]

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

function fmtTs(value) {
  if (value == null) return '(none)';
  if (typeof value === 'number') return new Date(value).toISOString();
  if (value.toDate) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const d = new Date(value);
    if (!isNaN(d)) return d.toISOString();
  }
  return String(value);
}

function describeField(name, val) {
  const t = val === null ? 'null' : Array.isArray(val) ? 'array' : typeof val;
  let display;
  if (val === undefined) display = '<undefined>';
  else if (val === null) display = '<null>';
  else if (val === '') display = '<empty string>';
  else if (typeof val === 'object') display = JSON.stringify(val).slice(0, 120);
  else display = String(val);
  return `  ${name.padEnd(28)} type=${t.padEnd(10)} value=${display}`;
}

async function inspectUserDoc(uid) {
  console.log(`\n========================================`);
  console.log(`USER DOC: users/${uid}`);
  console.log(`========================================`);
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) {
    console.log('NOT FOUND');
    return null;
  }
  const data = snap.data();
  const keys = Object.keys(data || {});
  console.log(`Fields: ${keys.length}`);
  if (keys.length === 0) {
    console.log('  (DOC EXISTS BUT IS COMPLETELY EMPTY)');
  } else {
    keys.sort();
    keys.forEach((k) => console.log(describeField(k, data[k])));
  }
  return data;
}

async function inspectAuthRecord(uid) {
  console.log(`\nFIREBASE AUTH RECORD:`);
  try {
    const userRecord = await admin.auth().getUser(uid);
    console.log(`  email:                ${userRecord.email || '(none)'}`);
    console.log(`  emailVerified:        ${userRecord.emailVerified}`);
    console.log(`  displayName:          ${userRecord.displayName || '(none)'}`);
    console.log(`  phoneNumber:          ${userRecord.phoneNumber || '(none)'}`);
    console.log(`  disabled:             ${userRecord.disabled}`);
    console.log(`  metadata.creationTime:    ${userRecord.metadata?.creationTime || '(none)'}`);
    console.log(`  metadata.lastSignInTime:  ${userRecord.metadata?.lastSignInTime || '(none)'}`);
    console.log(`  metadata.lastRefreshTime: ${userRecord.metadata?.lastRefreshTime || '(none)'}`);
    console.log(`  providerData (count=${userRecord.providerData?.length || 0}):`);
    (userRecord.providerData || []).forEach((p, idx) => {
      console.log(`    [${idx}] providerId=${p.providerId}  uid=${p.uid}  email=${p.email || '(none)'}  displayName=${p.displayName || '(none)'}`);
    });
    console.log(`  customClaims:         ${JSON.stringify(userRecord.customClaims || {})}`);
    return userRecord;
  } catch (e) {
    console.log(`  AUTH GET FAILED: ${e.message}`);
    return null;
  }
}

async function listUserOrders(uid) {
  console.log(`\nORDERS UNDER THIS USER:`);
  const snap = await db.collection('users').doc(uid).collection('orders').get();
  if (snap.empty) {
    console.log('  (none)');
    return [];
  }
  const orders = snap.docs.map((d) => {
    const o = d.data();
    let ms = null;
    if (typeof o.createdAt === 'number') ms = o.createdAt;
    else if (o.createdAt?.toDate) ms = o.createdAt.toDate().getTime();
    return { id: d.id, ms, senderEmail: o.senderEmail, senderName: o.senderName, status: o.status };
  });
  orders.sort((a, b) => (a.ms || 0) - (b.ms || 0));
  orders.forEach((o, i) => {
    console.log(`  [${i + 1}] ${o.id}  createdAt=${o.ms ? new Date(o.ms).toISOString() : '(none)'}  status=${o.status || '(none)'}  senderEmail=${o.senderEmail || '(none)'}`);
  });
  return orders;
}

// Sample-scan how widespread the empty-user-doc pattern is.
async function scanPattern(sampleSize) {
  console.log(`\n========================================`);
  console.log(`SCAN: How widespread is the empty-user-doc pattern?`);
  console.log(`========================================`);
  console.log(`Sampling up to ${sampleSize} users with at least one order...\n`);

  const usersSnap = await db.collection('users').limit(sampleSize * 3).get();
  let scanned = 0;
  let withOrders = 0;
  let emptyDocWithOrders = 0;
  let missingEmailWithOrders = 0;
  let missingDisplayNameWithOrders = 0;
  let missingCreatedAtWithOrders = 0;

  const examplesEmpty = [];
  const examplesMissingEmailOnly = [];

  for (const userDoc of usersSnap.docs) {
    scanned += 1;
    const u = userDoc.data();
    const ordersSnap = await db.collection('users').doc(userDoc.id).collection('orders').limit(1).get();
    if (ordersSnap.empty) continue;
    withOrders += 1;
    const fieldCount = Object.keys(u || {}).length;
    const hasEmail = Boolean(u.email);
    const hasDisplayName = Boolean(u.displayName);
    const hasCreatedAt = Boolean(u.createdAt);
    if (fieldCount === 0) {
      emptyDocWithOrders += 1;
      if (examplesEmpty.length < 5) examplesEmpty.push(userDoc.id);
    }
    if (!hasEmail) {
      missingEmailWithOrders += 1;
      if (!hasDisplayName && !hasCreatedAt && fieldCount > 0 && examplesMissingEmailOnly.length < 5) {
        // doc has SOME data but no email
        examplesMissingEmailOnly.push(userDoc.id);
      }
    }
    if (!hasDisplayName) missingDisplayNameWithOrders += 1;
    if (!hasCreatedAt) missingCreatedAtWithOrders += 1;
    if (withOrders >= sampleSize) break;
  }

  console.log(`Scanned ${scanned} user docs.`);
  console.log(`Of those, ${withOrders} had at least one order.\n`);
  if (withOrders === 0) {
    console.log('No order-having users in sample.');
    return;
  }
  console.log(`Among ${withOrders} order-having users:`);
  console.log(`  ${emptyDocWithOrders} (${pct(emptyDocWithOrders, withOrders)}) have COMPLETELY empty user doc.`);
  console.log(`  ${missingEmailWithOrders} (${pct(missingEmailWithOrders, withOrders)}) are missing email field.`);
  console.log(`  ${missingDisplayNameWithOrders} (${pct(missingDisplayNameWithOrders, withOrders)}) are missing displayName field.`);
  console.log(`  ${missingCreatedAtWithOrders} (${pct(missingCreatedAtWithOrders, withOrders)}) are missing createdAt field.`);
  if (examplesEmpty.length) {
    console.log(`\nExamples of completely-empty user docs (uid):`);
    examplesEmpty.forEach((id) => console.log(`  ${id}`));
  }
  if (examplesMissingEmailOnly.length) {
    console.log(`\nExamples of partial-data user docs (uid):`);
    examplesMissingEmailOnly.forEach((id) => console.log(`  ${id}`));
  }
}

function pct(n, total) {
  if (!total) return '0.0%';
  return `${((n / total) * 100).toFixed(1)}%`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sampleSize = args['scan-sample'] ? parseInt(args['scan-sample'], 10) : 200;

  const uids = [];
  if (args.uid) uids.push(args.uid);
  if (!uids.length) {
    console.log('No --uid given. Running scan only.');
  }

  for (const uid of uids) {
    await inspectUserDoc(uid);
    await inspectAuthRecord(uid);
    await listUserOrders(uid);
  }

  if (args['scan-sample'] || !uids.length) {
    await scanPattern(sampleSize);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('diag failed:', err);
  process.exit(1);
});
