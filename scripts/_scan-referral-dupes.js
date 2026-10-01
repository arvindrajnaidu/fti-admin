// Scan all referral docs for duplicate (campaignId, referee.uid) pairs.
// A referee should have exactly one referral doc. Lists dupe groups.
try { require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env.local') }); } catch {}
const { db } = require('../lib/firebase');
(async () => {
  if (!db) { console.log('no db'); return; }
  const snap = await db.collection('referrals').get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(`Total referral docs: ${all.length}\n`);

  const groups = new Map();
  for (const r of all) {
    const key = `${r.campaignId || '?'}__${r.referee?.uid || '?'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const dupes = [...groups.entries()].filter(([, v]) => v.length > 1);
  if (!dupes.length) { console.log('No duplicates found.'); return; }

  console.log(`DUPLICATE GROUPS: ${dupes.length}\n`);
  for (const [key, docs] of dupes) {
    docs.sort((a, b) => (a.referralCreatedAt || 0) - (b.referralCreatedAt || 0));
    console.log(`=== ${key} ===`);
    console.log(`  referee: ${docs[0].referee?.email}  referrer: ${docs[0].referrer?.code}`);
    for (const d of docs) {
      console.log(`  - ${d.id}  status=${d.status}  created=${d.referralCreatedAt}  trigger=${d.triggerOrderId || 'null'}`);
    }
    // Recommend: keep the completed one (or the earliest); delete the rest.
    const completed = docs.filter((d) => d.status === 'completed');
    const keep = completed[0] || docs[0];
    const remove = docs.filter((d) => d.id !== keep.id);
    console.log(`  → KEEP ${keep.id} (${keep.status}); DELETE ${remove.map((d) => d.id).join(', ')}`);
    console.log('');
  }
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
