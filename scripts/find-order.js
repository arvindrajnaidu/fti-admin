// Find / look up orders in prod Firestore. Three modes, pick whichever
// fits the situation:
//
//   1. Direct doc lookup by (uid, orderId):
//      node scripts/find-order.js --uid <UID> --order-id <DOC_ID>
//
//   2. By a Slack "Order #" string (the full <uid>-<orderId>):
//      node scripts/find-order.js --slack-order-id <FULL_STRING>
//      Splits on the FIRST `-` so suffixes with `-` are safe.
//
//   3. By sender email:
//      node scripts/find-order.js --email <EMAIL>
//
//   4. Scan by restaurant + date window:
//      node scripts/find-order.js --restaurant <ID> --from 2026-05-31 --to 2026-06-02
//
// Loads .env.local + talks to the prod Firebase project (same pattern as
// scripts/top-customer-concentration.js). Run from admin/:
//   NODE_OPTIONS='--openssl-legacy-provider' node scripts/find-order.js ...

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

const { db } = require('../lib/firebase');

// ---- arg parsing (minimal, no external deps) ----
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

function usage() {
  console.error('Usage:');
  console.error('  find-order.js --uid <UID> --order-id <DOC_ID>');
  console.error('  find-order.js --slack-order-id <FULL_STRING>');
  console.error('  find-order.js --email <EMAIL>');
  console.error('  find-order.js --restaurant <ID> [--from YYYY-MM-DD] [--to YYYY-MM-DD]');
}

// ---- printing helpers ----
function toMs(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (value.toDate) return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return null;
}

function fmtTs(value) {
  const ms = toMs(value);
  return ms ? new Date(ms).toISOString() : '(none)';
}

function printOrder(uid, docId, o, { verbose = false } = {}) {
  console.log('---');
  console.log(`Order #:        ${uid}-${docId}`);
  console.log(`uid:            ${uid}`);
  console.log(`doc.id:         ${docId}`);
  console.log(`createdAt:      ${fmtTs(o.createdAt)}`);
  console.log(`status:         ${o.status || '(no status)'}`);
  console.log(`cancelledAt:    ${fmtTs(o.cancelledAt)}`);
  console.log(`cancelledBy:    ${o.cancelledBy || '(none)'}`);
  console.log(`cancelReason:   ${o.cancelReason || '(none)'}`);
  console.log(`dispatchedAt:   ${fmtTs(o.dispatchedAt)}`);
  console.log(`totalAmount:    ${o.totalAmount}  (paise)`);
  console.log(`deliveryType:   ${o.deliveryType}`);
  console.log(`restaurant:     ${o.restaurantName} (id=${o.restaurantId})`);
  console.log(`senderName:     ${o.senderName}`);
  console.log(`senderEmail:    ${o.senderEmail}`);
  console.log(`recipient.name: ${o.recipient?.name}`);
  console.log(`recipient phone:${o.recipient?.recipientPhoneE164}  country=${o.recipient?.recipientPhoneCountry}`);
  console.log(`recipient door: ${o.recipient?.doorNo}`);
  console.log(`recipient addr: ${o.recipient?.location?.formattedAddress}`);
  console.log(`payment:        ${o.paymentIntent?.status || '(none)'}  id=${o.paymentIntent?.id || '(none)'}  amount=${o.paymentIntent?.amount || '(none)'} ${o.paymentIntent?.currency || ''}`);
  console.log(`recipientContact.status: ${o.recipientContact?.status || '(none)'}`);
  if (verbose) {
    console.log('FULL DOC:');
    console.log(JSON.stringify(o, null, 2).slice(0, 6000));
  }
}

function printUserBrief(uid, u) {
  console.log(`uid:          ${uid}`);
  console.log(`email:        ${u?.email || '(missing on user doc)'}`);
  console.log(`displayName:  ${u?.displayName || '(none)'}`);
  console.log(`createdAt:    ${fmtTs(u?.createdAt)}`);
  console.log(`providerId:   ${u?.providerId || '(none)'}`);
}

// ---- mode 1 / 2: direct lookup by (uid, orderId) ----
async function lookupByUidAndOrderId(uid, orderId) {
  console.log(`Looking up users/${uid}/orders/${orderId}\n`);

  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) {
    console.log('USER DOC: NOT FOUND');
  } else {
    console.log('USER DOC: FOUND');
    printUserBrief(uid, userSnap.data());
  }
  console.log('');

  const orderSnap = await db.collection('users').doc(uid).collection('orders').doc(orderId).get();
  if (!orderSnap.exists) {
    console.log('ORDER DOC: NOT FOUND');
    if (userSnap.exists) {
      console.log('\nListing ALL orders under this user (to spot OCR-mangled doc IDs):');
      const allOrders = await db.collection('users').doc(uid).collection('orders').get();
      console.log(`User has ${allOrders.size} orders total.\n`);
      allOrders.docs
        .map((d) => ({ id: d.id, ms: toMs(d.data().createdAt), data: d.data() }))
        .sort((a, b) => (b.ms || 0) - (a.ms || 0))
        .forEach((row) => {
          console.log(`  ${row.id}  status=${row.data.status || '(none)'}  createdAt=${row.ms ? new Date(row.ms).toISOString() : '(none)'}  restaurant=${row.data.restaurantName || '(no name)'}`);
        });
    }
    return;
  }

  console.log('ORDER DOC: FOUND');
  printOrder(uid, orderSnap.id, orderSnap.data(), { verbose: false });
}

// ---- mode 3: by sender email ----
async function lookupBySenderEmail(email) {
  const e = email.trim();
  console.log(`Searching for sender email "${e}"\n`);

  // First by user-doc email (some users have the field; many don't).
  const usersSnap = await db.collection('users').where('email', '==', e.toLowerCase()).get();
  if (usersSnap.empty) {
    console.log('No user doc with email=' + e + ' (lowercase). Trying exact case...');
    const exactSnap = await db.collection('users').where('email', '==', e).get();
    if (!exactSnap.empty) {
      console.log(`Found ${exactSnap.size} via exact case.`);
    }
  } else {
    console.log(`Found ${usersSnap.size} user(s) by user-doc email.\n`);
    for (const userDoc of usersSnap.docs) {
      printUserBrief(userDoc.id, userDoc.data());
      const ordersSnap = await db.collection('users').doc(userDoc.id).collection('orders').get();
      ordersSnap.forEach((d) => printOrder(userDoc.id, d.id, d.data()));
    }
  }

  // Fallback: scan ALL orders by senderEmail (covers users whose doc-level
  // email field is missing - turns up via the order's senderEmail field).
  console.log('\nScanning order docs by senderEmail (catches users with missing email on user doc)...');
  const allUsers = await db.collection('users').get();
  const found = [];
  const batchSize = 50;
  const userDocs = allUsers.docs;
  for (let i = 0; i < userDocs.length; i += batchSize) {
    const batch = userDocs.slice(i, i + batchSize);
    await Promise.all(batch.map(async (userDoc) => {
      const ordersSnap = await db
        .collection('users').doc(userDoc.id)
        .collection('orders')
        .where('senderEmail', '==', e)
        .get();
      ordersSnap.forEach((d) => found.push({ uid: userDoc.id, docId: d.id, data: d.data() }));
    }));
  }
  console.log(`Found ${found.length} order(s) where senderEmail == "${e}".\n`);
  found
    .sort((a, b) => (toMs(b.data.createdAt) || 0) - (toMs(a.data.createdAt) || 0))
    .forEach(({ uid, docId, data }) => printOrder(uid, docId, data));
}

// ---- mode 4: scan by restaurant + date window ----
async function scanByRestaurant({ restaurantId, fromIso, toIso }) {
  const fromMs = fromIso ? new Date(`${fromIso}T00:00:00Z`).getTime() : -Infinity;
  const toMs2 = toIso ? new Date(`${toIso}T00:00:00Z`).getTime() : Infinity;
  console.log(`Scanning all orders with restaurantId="${restaurantId}" between ${fromMs === -Infinity ? '(any)' : new Date(fromMs).toISOString()} and ${toMs2 === Infinity ? '(any)' : new Date(toMs2).toISOString()}\n`);

  const usersSnap = await db.collection('users').get();
  console.log(`Got ${usersSnap.size} users. Scanning per-user orders...\n`);

  const matches = [];
  const batchSize = 50;
  const userDocs = usersSnap.docs;
  for (let i = 0; i < userDocs.length; i += batchSize) {
    const batch = userDocs.slice(i, i + batchSize);
    await Promise.all(batch.map(async (userDoc) => {
      const ordersSnap = await db.collection('users').doc(userDoc.id).collection('orders').get();
      ordersSnap.forEach((d) => {
        const o = d.data();
        const ms = toMs(o.createdAt);
        if (ms == null || ms < fromMs || ms >= toMs2) return;
        if (String(o.restaurantId) !== String(restaurantId)) return;
        matches.push({ uid: userDoc.id, docId: d.id, data: o });
      });
    }));
  }
  console.log(`Matches: ${matches.length}\n`);
  matches
    .sort((a, b) => (toMs(a.data.createdAt) || 0) - (toMs(b.data.createdAt) || 0))
    .forEach(({ uid, docId, data }) => printOrder(uid, docId, data));
}

// ---- main ----
async function main() {
  const args = parseArgs(process.argv.slice(2));

  let uid = args.uid;
  let orderId = args['order-id'];

  if (args['slack-order-id']) {
    const s = String(args['slack-order-id']);
    const idx = s.indexOf('-');
    if (idx < 0) {
      console.error('--slack-order-id must contain a "-" separator');
      process.exit(1);
    }
    uid = s.slice(0, idx);
    orderId = s.slice(idx + 1);
  }

  if (uid && orderId) {
    await lookupByUidAndOrderId(uid, orderId);
    process.exit(0);
  }

  if (args.email) {
    await lookupBySenderEmail(args.email);
    process.exit(0);
  }

  if (args.restaurant) {
    await scanByRestaurant({
      restaurantId: args.restaurant,
      fromIso: args.from,
      toIso: args.to,
    });
    process.exit(0);
  }

  usage();
  process.exit(1);
}

main().catch((err) => {
  console.error('find-order failed:', err);
  process.exit(1);
});
