// One-off lookup: print the recipient block for a specific order so we can
// see exactly what got persisted (recipientPhone / recipientPhoneE164 /
// recipientPhoneCountry / recipientPhoneIsWhatsApp) and compare against what
// Slack rendered.
//
// Run: cd admin && FIREBASE_ENV=production node scripts/_check-order-recipient.js
try {
  require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env.local') });
} catch {}
process.env.FIREBASE_ENV = process.env.FIREBASE_ENV || 'production';

const { db } = require('../lib/firebase');

const SENDER_EMAIL = 'ntinasiwkoysuckass@yahoo.com';
const ORDER_ID = 'XjADcbeA6RmTtqB4m9J4';
const USER_ID_FROM_SLACK = 'l4ac4EXkE6ONcYaPZkJtIROA6BG2';

async function main() {
  if (!db) {
    console.log('Firebase not initialized');
    return;
  }

  // Strategy 1: collectionGroup across all users' orders subcollection,
  // matched by the orderId. This works regardless of which uid owns it.
  console.log('--- Strategy 1: collectionGroup("orders") where __name__ ==', ORDER_ID, '---');
  try {
    const cg = await db.collectionGroup('orders').get();
    let found = null;
    cg.forEach((doc) => {
      if (doc.id === ORDER_ID) found = doc;
    });
    if (found) {
      const data = found.data();
      console.log('Found at path:', found.ref.path);
      console.log('\n=== recipient ===');
      console.log(JSON.stringify(data.recipient, null, 2));
      console.log('\n=== top-level fields of interest ===');
      console.log(JSON.stringify({
        senderEmail: data.senderEmail,
        senderName: data.senderName,
        notes: data.notes,
        createdAt: data.createdAt,
        status: data.status,
      }, null, 2));
      return;
    }
    console.log('Not found via collectionGroup scan');
  } catch (e) {
    console.log('collectionGroup query failed:', e.message);
  }

  // Strategy 2: find user by email, then list orders.
  console.log('\n--- Strategy 2: users where email ==', SENDER_EMAIL, '---');
  const userSnap = await db.collection('users').where('email', '==', SENDER_EMAIL).limit(5).get();
  console.log('User docs matching email:', userSnap.size);
  for (const u of userSnap.docs) {
    console.log('  uid:', u.id, 'displayName:', u.data().displayName);
    const orders = await db.collection('users').doc(u.id).collection('orders').orderBy('createdAt', 'desc').limit(5).get();
    console.log('  recent orders for this uid:');
    orders.forEach((o) => {
      console.log('    -', o.id, 'createdAt:', o.data().createdAt);
    });
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
