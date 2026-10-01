// Attribution survey insights since launch (2026-05-04).
//
// Reads the `attribution-surveys` Firestore collection (written by
// foodtoindia/pages/api/attribution/submit.js for every first-order
// customer who answers "where did you hear about us?" on the success
// page) and prints:
//
//   1. Response volume + rough response rate vs. eligible first-order
//      customers acquired since launch.
//   2. Source breakdown (google / ai_search / friend / other) with
//      counts and percentages.
//   3. Verbatim custom text for "other" responses.
//   4. Friend referrals — friend name/email + thank-you email status.
//   5. Daily time-series (count by day since launch).
//
// Loads .env.local; talks to the prod Firebase project when
// FIREBASE_ENV=production. Filters fraud users via lib/fraudUsers.
//
// Run from admin/:
//   FIREBASE_ENV=production NODE_OPTIONS='--openssl-legacy-provider' \
//     node scripts/attribution-survey-insights.js

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

const LAUNCH_MS = new Date('2026-05-04T22:00:00Z').getTime(); // commit timestamp UTC
const DAY_MS = 1000 * 60 * 60 * 24;

const isExcluded = (email) => {
  if (!email) return false;
  const e = email.toLowerCase().trim();
  if (TEST_ACCOUNTS.has(e)) return true;
  if (!isValidUser(e)) return true;
  return false;
};

const pct = (n, d) => (d === 0 ? '0.0%' : `${((n / d) * 100).toFixed(1)}%`);

const SOURCE_LABELS = {
  google: 'Google search',
  ai_search: 'AI search (ChatGPT / Gemini / Claude)',
  friend: 'Friend told me',
  other: 'Other',
};

async function loadUsers() {
  console.log(`Reading users from Firestore project ${process.env.FIREBASE_ENV === 'production' ? 'foodtoindia (PROD)' : 'foodtoindia-dev'}...`);
  const snap = await db.collection('users').get();
  const byUid = new Map();
  snap.docs.forEach((d) => {
    const data = d.data();
    byUid.set(d.id, {
      uid: d.id,
      email: (data.email || '').toLowerCase().trim(),
      name: data.displayName || data.name || '',
      orderCount: data.orderCount || 0,
      createdAtMs: typeof data.createdAt === 'number' ? data.createdAt : (data.createdAt?.toMillis?.() || null),
    });
  });
  console.log(`Loaded ${byUid.size} users.`);
  return byUid;
}

async function loadSurveys() {
  console.log('Reading attribution-surveys collection...');
  const snap = await db.collection('attribution-surveys').get();
  const surveys = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(`Loaded ${surveys.length} surveys.`);
  return surveys;
}

// First-order customers since launch are the eligible response pool.
// Best proxy: users whose first order's createdAt >= LAUNCH_MS. Since we
// only need a denominator, we approximate via orderCount >= 1 and the
// earliest order timestamp from the user's orders subcollection. To keep
// this script cheap, we use the user-doc createdAt as a stand-in (most
// users place their first order shortly after signing up); we flag this
// caveat in the output.
async function countFirstOrderUsersSinceLaunch(usersByUid) {
  let count = 0;
  for (const u of usersByUid.values()) {
    if (isExcluded(u.email)) continue;
    if (u.orderCount < 1) continue;
    if (!u.createdAtMs || u.createdAtMs < LAUNCH_MS) continue;
    count += 1;
  }
  return count;
}

function bucketByDay(surveys) {
  const buckets = new Map(); // 'YYYY-MM-DD' -> count
  for (const s of surveys) {
    const ms = typeof s.createdAt === 'number' ? s.createdAt : (s.createdAt?.toMillis?.() || 0);
    if (!ms) continue;
    const day = new Date(ms).toISOString().slice(0, 10);
    buckets.set(day, (buckets.get(day) || 0) + 1);
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function printSourceBreakdown(surveys) {
  const counts = { google: 0, ai_search: 0, friend: 0, other: 0 };
  for (const s of surveys) counts[s.source] = (counts[s.source] || 0) + 1;
  const total = surveys.length;

  console.log('\n=== Source breakdown ===');
  const order = ['google', 'ai_search', 'friend', 'other'];
  for (const k of order) {
    const c = counts[k] || 0;
    const bar = '█'.repeat(Math.round((c / Math.max(total, 1)) * 30));
    console.log(`  ${SOURCE_LABELS[k].padEnd(40)} ${String(c).padStart(3)}  ${pct(c, total).padStart(6)}  ${bar}`);
  }
  console.log(`  ${'TOTAL'.padEnd(40)} ${String(total).padStart(3)}`);
}

function printOtherResponses(surveys) {
  const others = surveys.filter((s) => s.source === 'other');
  console.log(`\n=== "Other" verbatim (${others.length}) ===`);
  if (others.length === 0) {
    console.log('  (none)');
    return;
  }
  for (const s of others) {
    const text = (s.customText || '').trim() || '(blank)';
    console.log(`  • ${text}`);
  }
}

function printFriendReferrals(surveys, usersByUid) {
  const friends = surveys.filter((s) => s.source === 'friend');
  const withName = friends.filter((s) => (s.friendName || '').trim());
  const withEmail = friends.filter((s) => (s.friendEmail || '').trim());
  const thanksSent = friends.filter((s) => s.thankYouSentAt);
  const thanksFailed = friends.filter((s) => s.thankYouFailed);

  console.log(`\n=== Friend referrals (${friends.length}) ===`);
  console.log(`  Provided friend name:  ${withName.length}/${friends.length}`);
  console.log(`  Provided friend email: ${withEmail.length}/${friends.length}`);
  console.log(`  Thank-you email sent:  ${thanksSent.length}`);
  console.log(`  Thank-you failed:      ${thanksFailed.length}${thanksFailed.length ? ' (reasons: ' + [...new Set(thanksFailed.map((s) => s.thankYouFailReason))].join(', ') + ')' : ''}`);

  if (friends.length === 0) return;

  console.log('\n  Detail:');
  for (const s of friends) {
    const u = usersByUid.get(s.uid);
    const sender = u ? (u.email || u.name || s.uid) : s.uid;
    const fname = (s.friendName || '').trim() || '—';
    const femail = (s.friendEmail || '').trim() || '—';
    const sent = s.thankYouSentAt ? '✓ thanked' : (s.thankYouFailed ? `✗ ${s.thankYouFailReason}` : '· no-email');
    console.log(`    ${sender.padEnd(40)} → ${fname} <${femail}>  ${sent}`);
  }
}

function printTimeSeries(surveys) {
  console.log('\n=== Daily time-series ===');
  const byDay = bucketByDay(surveys);
  if (byDay.length === 0) {
    console.log('  (no data)');
    return;
  }
  const max = Math.max(...byDay.map(([, c]) => c));
  for (const [day, c] of byDay) {
    const bar = '█'.repeat(Math.round((c / max) * 30));
    console.log(`  ${day}  ${String(c).padStart(3)}  ${bar}`);
  }
}

function printResponseRate(surveys, eligibleCount) {
  const validSurveys = surveys; // already filtered above
  console.log('\n=== Response volume ===');
  console.log(`  Surveys submitted (post-fraud-filter):  ${validSurveys.length}`);
  console.log(`  First-order customers since launch:     ~${eligibleCount}  (proxied by users.createdAt >= ${new Date(LAUNCH_MS).toISOString().slice(0, 10)})`);
  console.log(`  Approx response rate:                   ${pct(validSurveys.length, eligibleCount)}`);
  console.log('  Caveat: denominator uses user-doc createdAt as proxy for first-order date.');
  console.log('          Skip rate is not separately tracked — only submissions land in Firestore.');
}

async function main() {
  console.log(`Attribution survey insights — launched ${new Date(LAUNCH_MS).toISOString()}`);
  console.log(`Today: ${new Date().toISOString()}\n`);

  const [usersByUid, allSurveys] = await Promise.all([loadUsers(), loadSurveys()]);

  // Build email lookup by uid for fraud filter.
  const surveys = allSurveys.filter((s) => {
    const u = usersByUid.get(s.uid);
    return !u || !isExcluded(u.email);
  });
  const droppedFraud = allSurveys.length - surveys.length;
  if (droppedFraud > 0) {
    console.log(`(Dropped ${droppedFraud} surveys from fraud / test accounts.)`);
  }

  const eligibleCount = await countFirstOrderUsersSinceLaunch(usersByUid);

  printResponseRate(surveys, eligibleCount);
  printSourceBreakdown(surveys);
  printTimeSeries(surveys);
  printOtherResponses(surveys);
  printFriendReferrals(surveys, usersByUid);

  console.log('\nDone.');
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
