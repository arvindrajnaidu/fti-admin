// One-off: look up a user by email and report Stripe payment state.
// Used to diagnose "saved cards not showing" for a specific user.
//
// Run from admin/:
//   NODE_OPTIONS='--openssl-legacy-provider' node scripts/check-user-stripe.js demo@foodtoindia.com

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

const { db, admin } = require('../lib/firebase');

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: node scripts/check-user-stripe.js <email>');
    process.exit(1);
  }

  console.log(`\nLooking up: ${email}\n`);

  let userRecord;
  try {
    userRecord = await admin.auth().getUserByEmail(email);
  } catch (e) {
    console.error(`Firebase Auth: no user with email ${email}`);
    console.error(e.message);
    process.exit(2);
  }

  console.log(`Firebase Auth uid: ${userRecord.uid}`);
  console.log(`  created       : ${userRecord.metadata.creationTime}`);
  console.log(`  last sign-in  : ${userRecord.metadata.lastSignInTime || '(never)'}`);

  const userDoc = await db.collection('users').doc(userRecord.uid).get();
  if (!userDoc.exists) {
    console.log('\nFirestore users/{uid}: DOES NOT EXIST');
    console.log('-> /api/payment-methods would treat this as no stripeCustomerId and return [].');
    process.exit(0);
  }

  const data = userDoc.data();
  console.log('\nFirestore users/{uid} doc keys:', Object.keys(data).sort().join(', '));
  console.log(`  stripeCustomerId        : ${data.stripeCustomerId || '(not set)'}`);
  console.log(`  defaultPaymentMethodId  : ${data.defaultPaymentMethodId || '(not set)'}`);
  console.log(`  recipients              : ${Array.isArray(data.recipients) ? data.recipients.length + ' entries' : '(not an array)'}`);

  if (!data.stripeCustomerId) {
    console.log('\nNo stripeCustomerId on the user doc.');
    console.log('-> /api/payment-methods returns paymentMethods: [].');
    console.log('-> Cart will show the empty CardElement, no saved-card RadioGroup.');
    console.log('-> Either this user has never completed a Stripe charge, or the');
    console.log('   first-charge path did not call getOrCreateStripeCustomer.');
    process.exit(0);
  }

  // Stripe API check
  const stripeKey = process.env.stripe_secret_key || process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    console.log('\nstripe_secret_key not in env; skipping live Stripe check.');
    process.exit(0);
  }

  const stripe = require('stripe')(stripeKey);
  console.log('\nStripe customer:', data.stripeCustomerId);
  let customer;
  try {
    customer = await stripe.customers.retrieve(data.stripeCustomerId);
    console.log(`  email           : ${customer.email}`);
    console.log(`  created         : ${new Date(customer.created * 1000).toISOString()}`);
    console.log(`  livemode        : ${customer.livemode}`);
  } catch (e) {
    console.error(`Stripe customer retrieve failed: ${e.message}`);
    process.exit(3);
  }

  const pms = await stripe.paymentMethods.list({
    customer: data.stripeCustomerId,
    type: 'card',
    limit: 20,
  });
  console.log(`\nStripe payment_methods attached (type=card): ${pms.data.length}`);
  for (const pm of pms.data) {
    console.log(`  - ${pm.id} : ${pm.card?.brand || '?'} •••• ${pm.card?.last4 || '?'} exp ${pm.card?.exp_month}/${pm.card?.exp_year}`);
  }
  if (pms.data.length === 0) {
    console.log('-> /api/payment-methods returns []. The customer exists on Stripe but no cards.');
    console.log('   To populate: place an order with "Save card for future purchases" checked.');
  } else {
    console.log('-> /api/payment-methods should return these. If cart still shows empty, check:');
    console.log('   (a) /api/payment-methods response in DevTools Network tab');
    console.log('   (b) browser console for fetch errors');
    console.log('   (c) Firebase ID token being sent in x-id-token header');
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('Script failed:', e);
  process.exit(1);
});
