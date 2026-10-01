// Weekly count of orders by recipient phone country (IN vs non-IN) for
// the last ~month. Asked 2026-06-01 to size the international-recipient
// cohort for the BugF / BugL adoption work.
//
// Source of truth for recipient country:
//   1. order.recipient.recipientPhoneCountry (T2 backfill, set on every
//      new order write since ~April 2026)
//   2. fallback to order.recipient.recipientPhoneE164 prefix
//   3. fallback to order.recipient.recipientPhone (legacy 10-digit,
//      IN-implicit)
//
// Run from admin/:
//   NODE_OPTIONS='--openssl-legacy-provider' node scripts/weekly-non-in-orders.js

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
const { isValidUser } = require('../lib/fraudUsers');

const TEST_ACCOUNTS = new Set([
  'ath.sub.007@gmail.com',
  'trackwork.contact@gmail.com',
  'athahar+f1@gmail.com',
]);

// Country code prefixes (callingCode -> ISO2). Just the common ones we
// see in the data; anything else falls into 'OTHER'.
const PREFIX_TO_COUNTRY = [
  ['+91', 'IN'],
  ['+1',  'US'], // US/CA share +1 — disambiguate below
  ['+44', 'GB'],
  ['+61', 'AU'],
  ['+971', 'AE'],
  ['+65', 'SG'],
  ['+49', 'DE'],
  ['+353', 'IE'],
  ['+64', 'NZ'],
  ['+27', 'ZA'],
  ['+33', 'FR'],
  ['+31', 'NL'],
  ['+41', 'CH'],
  ['+46', 'SE'],
  ['+47', 'NO'],
  ['+45', 'DK'],
  ['+39', 'IT'],
  ['+34', 'ES'],
  ['+81', 'JP'],
  ['+82', 'KR'],
  ['+852', 'HK'],
  ['+886', 'TW'],
  ['+60', 'MY'],
  ['+66', 'TH'],
  ['+62', 'ID'],
  ['+63', 'PH'],
  ['+92', 'PK'],
  ['+880', 'BD'],
  ['+94', 'LK'],
  ['+977', 'NP'],
];

function countryFromE164(e164) {
  if (!e164 || typeof e164 !== 'string') return null;
  // Match longest prefix first.
  const sorted = [...PREFIX_TO_COUNTRY].sort((a, b) => b[0].length - a[0].length);
  for (const [prefix, country] of sorted) {
    if (e164.startsWith(prefix)) return country;
  }
  return 'OTHER';
}

function classifyOrder(o) {
  const r = o.recipient || {};
  if (r.recipientPhoneCountry) return r.recipientPhoneCountry;
  if (r.recipientPhoneE164) {
    const c = countryFromE164(r.recipientPhoneE164);
    if (c) return c;
  }
  // Legacy: 10-digit string in recipientPhone implies IN.
  if (r.recipientPhone) return 'IN';
  return 'UNKNOWN';
}

// ===== Weekly bucket setup =====
// Today: 2026-06-01 (Mon). Last 4 complete Mon-Sun weeks ending yesterday
// (2026-05-31, Sun). Plus the current in-progress week as a heads-up.
const WEEKS = [
  { label: 'May 4 - May 10',  start: '2026-05-04T00:00:00Z', end: '2026-05-11T00:00:00Z' },
  { label: 'May 11 - May 17', start: '2026-05-11T00:00:00Z', end: '2026-05-18T00:00:00Z' },
  { label: 'May 18 - May 24', start: '2026-05-18T00:00:00Z', end: '2026-05-25T00:00:00Z' },
  { label: 'May 25 - May 31', start: '2026-05-25T00:00:00Z', end: '2026-06-01T00:00:00Z' },
  { label: 'Jun 1 (in prog)', start: '2026-06-01T00:00:00Z', end: '2026-06-02T00:00:00Z' },
];
const WINDOW_START_MS = new Date(WEEKS[0].start).getTime();
const WINDOW_END_MS   = new Date(WEEKS[WEEKS.length - 1].end).getTime();

function bucketForMs(ms) {
  for (let i = 0; i < WEEKS.length; i += 1) {
    const w = WEEKS[i];
    const s = new Date(w.start).getTime();
    const e = new Date(w.end).getTime();
    if (ms >= s && ms < e) return i;
  }
  return -1;
}

async function main() {
  const proj = process.env.FIREBASE_ENV === 'production' ? 'foodtoindia (PROD)' : 'foodtoindia-dev';
  console.log(`Reading orders from Firestore project ${proj}...`);
  console.log(`Window: ${WEEKS[0].start.slice(0, 10)} to ${WEEKS[WEEKS.length - 1].end.slice(0, 10)} (${WEEKS.length} weekly buckets).`);

  const usersSnap = await db.collection('users').get();
  console.log(`Got ${usersSnap.size} users. Scanning per-user orders...\n`);

  // Per-week: counts of orders + Sets of unique sender UIDs and unique
  // recipient phone numbers. Lets us report "unique people" without
  // double-counting repeat orders from the same sender/recipient pair.
  const buckets = WEEKS.map(() => ({
    orders: { IN: 0, nonIN: 0, unknown: 0 },
    nonINByCountry: {},          // orders count per country
    sendersIN: new Set(),        // unique sender UIDs sending to IN
    sendersNonIN: new Set(),     // unique sender UIDs sending to non-IN
    sendersAny: new Set(),       // unique sender UIDs (denominator)
    recipientsIN: new Set(),     // unique recipient phone E164 (IN)
    recipientsNonIN: new Set(),  // unique recipient phone E164 (non-IN)
  }));

  let totalScanned = 0;
  let totalInWindow = 0;
  let fraudSkipped = 0;
  let usersProcessed = 0;

  const userDocs = usersSnap.docs;
  const batchSize = 50;
  for (let i = 0; i < userDocs.length; i += batchSize) {
    const batch = userDocs.slice(i, i + batchSize);
    await Promise.all(batch.map(async (userDoc) => {
      const userData = userDoc.data();
      const email = (userData?.email || '').toLowerCase().trim();
      if (!email) return;
      if (!isValidUser(email) || TEST_ACCOUNTS.has(email)) {
        fraudSkipped += 1;
        return;
      }
      usersProcessed += 1;

      const ordersSnap = await db
        .collection('users')
        .doc(userDoc.id)
        .collection('orders')
        .get();

      ordersSnap.forEach((orderDoc) => {
        const o = orderDoc.data();
        let ms = null;
        if (typeof o.createdAt === 'number') ms = o.createdAt;
        else if (o.createdAt?.toDate) ms = o.createdAt.toDate().getTime();
        else if (o.createdAt instanceof Date) ms = o.createdAt.getTime();
        if (ms == null) return;

        totalScanned += 1;
        if (ms < WINDOW_START_MS || ms >= WINDOW_END_MS) return;

        // Skip cancelled orders - they shouldn't count as "real" volume.
        if (o.status === 'cancelled') return;

        totalInWindow += 1;
        const bucketIdx = bucketForMs(ms);
        if (bucketIdx < 0) return;

        const country = classifyOrder(o);
        const senderUid = userDoc.id;
        const recipPhone = o.recipient?.recipientPhoneE164 || o.recipient?.recipientPhone || null;
        const bkt = buckets[bucketIdx];

        bkt.sendersAny.add(senderUid);
        if (country === 'IN') {
          bkt.orders.IN += 1;
          bkt.sendersIN.add(senderUid);
          if (recipPhone) bkt.recipientsIN.add(recipPhone);
        } else if (country === 'UNKNOWN') {
          bkt.orders.unknown += 1;
        } else {
          bkt.orders.nonIN += 1;
          bkt.sendersNonIN.add(senderUid);
          if (recipPhone) bkt.recipientsNonIN.add(recipPhone);
          bkt.nonINByCountry[country] = (bkt.nonINByCountry[country] || 0) + 1;
        }
      });
    }));
  }

  // ===== Output =====
  console.log(`Users scanned: ${usersProcessed} (fraud filtered: ${fraudSkipped})`);
  console.log(`Total orders scanned (all time): ${totalScanned}`);
  console.log(`Orders in the 5-week window (non-cancelled): ${totalInWindow}\n`);

  console.log('Weekly ORDER counts:');
  console.log('Week                 | IN  | non-IN | unknown | total | non-IN %');
  console.log('---------------------|-----|--------|---------|-------|---------');
  WEEKS.forEach((w, i) => {
    const b = buckets[i];
    const total = b.orders.IN + b.orders.nonIN + b.orders.unknown;
    const pct = total > 0 ? ((b.orders.nonIN / total) * 100).toFixed(1) : '0.0';
    console.log(
      `${w.label.padEnd(20)} | ${String(b.orders.IN).padStart(3)} | ${String(b.orders.nonIN).padStart(6)} | ${String(b.orders.unknown).padStart(7)} | ${String(total).padStart(5)} | ${pct.padStart(6)}%`
    );
  });

  console.log('\nWeekly UNIQUE SENDERS (Firebase UIDs - dedupes repeat orders):');
  console.log('Week                 | senders→IN | senders→nonIN | senders total | non-IN share');
  console.log('---------------------|------------|---------------|---------------|-------------');
  WEEKS.forEach((w, i) => {
    const b = buckets[i];
    const sIN = b.sendersIN.size;
    const sNonIN = b.sendersNonIN.size;
    const sAny = b.sendersAny.size;
    const pct = sAny > 0 ? ((sNonIN / sAny) * 100).toFixed(1) : '0.0';
    console.log(
      `${w.label.padEnd(20)} | ${String(sIN).padStart(10)} | ${String(sNonIN).padStart(13)} | ${String(sAny).padStart(13)} | ${pct.padStart(10)}%`
    );
  });
  console.log('Note: a single sender can appear in both columns if they shipped to both IN + non-IN that week.');

  console.log('\nWeekly UNIQUE RECIPIENTS (recipient phone E.164):');
  console.log('Week                 | rcpts IN | rcpts nonIN');
  console.log('---------------------|----------|------------');
  WEEKS.forEach((w, i) => {
    const b = buckets[i];
    console.log(
      `${w.label.padEnd(20)} | ${String(b.recipientsIN.size).padStart(8)} | ${String(b.recipientsNonIN.size).padStart(11)}`
    );
  });

  console.log('\nNon-IN by destination country (orders per week):');
  WEEKS.forEach((w, i) => {
    const b = buckets[i];
    const entries = Object.entries(b.nonINByCountry).sort((a, b2) => b2[1] - a[1]);
    if (entries.length === 0) {
      console.log(`  ${w.label}: (none)`);
      return;
    }
    const detail = entries.map(([c, n]) => `${c}:${n}`).join(', ');
    console.log(`  ${w.label}: ${detail}`);
  });

  // ===== 4-week complete roll-up =====
  const completeWeeks = buckets.slice(0, 4);
  const totalIN = completeWeeks.reduce((s, b) => s + b.orders.IN, 0);
  const totalNonIN = completeWeeks.reduce((s, b) => s + b.orders.nonIN, 0);
  const totalUnknown = completeWeeks.reduce((s, b) => s + b.orders.unknown, 0);
  const grand = totalIN + totalNonIN + totalUnknown;

  // Dedupe senders / recipients across all 4 weeks (set union).
  const sendersINUnique = new Set();
  const sendersNonINUnique = new Set();
  const sendersAnyUnique = new Set();
  const recipientsINUnique = new Set();
  const recipientsNonINUnique = new Set();
  completeWeeks.forEach((b) => {
    b.sendersIN.forEach((u) => sendersINUnique.add(u));
    b.sendersNonIN.forEach((u) => sendersNonINUnique.add(u));
    b.sendersAny.forEach((u) => sendersAnyUnique.add(u));
    b.recipientsIN.forEach((p) => recipientsINUnique.add(p));
    b.recipientsNonIN.forEach((p) => recipientsNonINUnique.add(p));
  });

  console.log('\n=== 4-week complete totals (May 4 - May 31) ===');
  console.log('Orders:');
  console.log(`  IN     : ${totalIN}`);
  console.log(`  non-IN : ${totalNonIN}  (${grand > 0 ? ((totalNonIN / grand) * 100).toFixed(1) : '0.0'}% of orders)`);
  console.log(`  total  : ${grand}`);
  console.log('Unique SENDERS (deduped across 4 weeks):');
  console.log(`  any sender               : ${sendersAnyUnique.size}`);
  console.log(`  shipped to IN at least 1x: ${sendersINUnique.size}`);
  console.log(`  shipped to nonIN ≥1x     : ${sendersNonINUnique.size}  (${sendersAnyUnique.size > 0 ? ((sendersNonINUnique.size / sendersAnyUnique.size) * 100).toFixed(1) : '0.0'}% of senders)`);
  // Senders who did BOTH (intersection).
  let both = 0;
  sendersNonINUnique.forEach((uid) => { if (sendersINUnique.has(uid)) both += 1; });
  console.log(`  shipped to BOTH IN+nonIN : ${both}`);
  console.log('Unique RECIPIENTS (deduped across 4 weeks):');
  console.log(`  IN recipients   : ${recipientsINUnique.size}`);
  console.log(`  nonIN recipients: ${recipientsNonINUnique.size}`);
  console.log(`  ratio: ${recipientsNonINUnique.size > 0 ? (totalNonIN / recipientsNonINUnique.size).toFixed(2) : '0'} orders/nonIN-recipient   vs.   ${recipientsINUnique.size > 0 ? (totalIN / recipientsINUnique.size).toFixed(2) : '0'} orders/IN-recipient`);

  // Country roll-up across the 4 complete weeks
  const countryTotals = {};
  completeWeeks.forEach((b) => {
    for (const [c, n] of Object.entries(b.nonINByCountry)) {
      countryTotals[c] = (countryTotals[c] || 0) + n;
    }
  });
  const rollup = Object.entries(countryTotals).sort((a, b2) => b2[1] - a[1]);
  if (rollup.length > 0) {
    console.log('\nNon-IN by country, 4-week roll-up (orders):');
    rollup.forEach(([c, n]) => console.log(`  ${c}: ${n}`));
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('weekly-non-in-orders failed:', err);
  process.exit(1);
});
