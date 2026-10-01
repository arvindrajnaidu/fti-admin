// READ-ONLY diagnostic. Print a referrer's referral balance + stats +
// transaction ledger. Finds the user by referral code.
//
// Run: node scripts/_check-referrer-balance.js RAJETBSB
try {
  require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env.local') });
} catch {}
const { db } = require('../lib/firebase');

const CODE = process.argv[2] || 'RAJETBSB';

(async () => {
  if (!db) { console.log('no db'); return; }

  // Find the referrer's uid via a referral doc carrying this code.
  const snap = await db.collection('referrals').get();
  const withCode = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => r.referrer?.code === CODE);

  if (!withCode.length) { console.log(`No referral docs with code ${CODE}`); return; }

  const uid = withCode[0].referrer?.uid;
  const name = withCode[0].referrer?.name;
  console.log(`Referrer: ${name}  code=${CODE}  uid=${uid}`);
  console.log(`Referral docs created by this referrer: ${withCode.length}`);
  for (const r of withCode) {
    console.log(`  - ${r.id}  status=${r.status}  referee=${r.referee?.email}`);
  }

  // User doc — credits + stats.
  const u = await db.collection('users').doc(uid).get();
  if (!u.exists) { console.log('User doc not found'); return; }
  const data = u.data();
  console.log('\n=== referralCredits (cents) ===');
  console.log(JSON.stringify(data.referralCredits || null, null, 2));
  console.log('\n=== referralStats ===');
  console.log(JSON.stringify(data.referralStats || null, null, 2));

  // Transaction ledger for this uid.
  const txns = await db.collection('referral-transactions').where('uid', '==', uid).get();
  console.log(`\n=== referral-transactions (${txns.size}) — amounts in USD dollars ===`);
  txns.docs
    .map((d) => d.data())
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    .forEach((t) => {
      console.log(`  ${new Date(t.timestamp).toISOString()}  ${t.type}  ${t.amount?.direction} $${t.amount?.amountUSD}  bal ${t.balance?.beforeUSD}→${t.balance?.afterUSD}  ${t.notes || ''}`);
    });
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
