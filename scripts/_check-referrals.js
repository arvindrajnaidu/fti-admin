// Dump referral docs for a given referee email — diagnose duplicates.
try { require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env.local') }); } catch {}
const { db } = require('../lib/firebase');
const EMAIL = process.argv[2] || 'banashri@gmail.com';
(async () => {
  if (!db) { console.log('no db'); return; }
  const snap = await db.collection('referrals').get();
  const matches = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => (r.referee?.email || '').toLowerCase() === EMAIL.toLowerCase());
  console.log(`Referral docs for referee ${EMAIL}: ${matches.length}\n`);
  for (const m of matches) {
    console.log('docId:', m.id);
    console.log('  status:', m.status);
    console.log('  referee.uid:', m.referee?.uid);
    console.log('  referrer:', m.referrer?.code, m.referrer?.name);
    console.log('  referralCreatedAt:', m.referralCreatedAt, new Date(m.referralCreatedAt).toISOString());
    console.log('  triggerOrderId:', m.triggerOrderId);
    console.log('');
  }
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
