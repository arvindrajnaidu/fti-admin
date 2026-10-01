// Diagnostic: look up an order by ID via collectionGroup query (same
// path the foodtoindia /api/confirm-order-lookup uses) and print its
// recipientContact so we can compare token vs URL token.
//
// Run from admin dir:
//   node scripts/_check-confirm-token.js <orderId> [token]
//   FIREBASE_ENV=production node scripts/_check-confirm-token.js <id>

try {
  require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env.local') });
} catch {}

const admin = require('firebase-admin');
const { db } = require('../lib/firebase');

const ORDER_ID = process.argv[2];
const URL_TOKEN = process.argv[3] || null;

async function main() {
  if (!db) { console.log('Firebase not initialized'); return; }
  if (!ORDER_ID) {
    console.log('Usage: node scripts/_check-confirm-token.js <orderId> [token]');
    return;
  }

  console.log(`Project: ${process.env.FIREBASE_ENV === 'production' ? 'foodtoindia (PROD)' : 'foodtoindia-dev (DEV)'}`);
  console.log(`Looking up orderId: ${ORDER_ID}\n`);

  try {
    const FieldPath = admin.firestore.FieldPath;
    const snap = await db
      .collectionGroup('orders')
      .where(FieldPath.documentId(), '==', ORDER_ID)
      .limit(1)
      .get();

    if (snap.empty) {
      console.log('❌ Order not found via collectionGroup query.');
      return;
    }

    const doc = snap.docs[0];
    const data = doc.data();
    console.log('✅ Order found at path:', doc.ref.path);
    console.log('\n=== recipientContact ===');
    console.log(JSON.stringify(data.recipientContact || null, null, 2));

    if (URL_TOKEN) {
      const stored = data.recipientContact?.confirmToken;
      console.log('\n=== Token comparison ===');
      console.log('URL token:    ', URL_TOKEN);
      console.log('Stored token: ', stored);
      console.log('Match:', stored === URL_TOKEN ? '✅ YES' : '❌ NO');
    }
  } catch (err) {
    console.log('❌ Query error:', err.message);
    if (err.code) console.log('   code:', err.code);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
