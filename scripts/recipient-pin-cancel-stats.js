// Recipient pin coverage + cancellation-by-phone-country stats.
//
// Drives the recipient-pin-plan decisions:
//   Q1. Of cancelled orders in the last 90 days, what % had recipients
//       with international phone numbers? Filtered to cancellations whose
//       reason text suggests an address/location problem.
//   Q2. Of all orders in the last 90 days, what % have a precise map pin
//       (recipient.location.addressComponents populated)? Split by phone
//       country (IN vs international).
//
// Reads Firestore directly via Admin SDK; loads .env.local (same pattern
// as scripts/top-customer-concentration.js). Whichever Firebase project
// the .env.local points at is what gets queried; check the console line
// "Firebase Admin initialized for: ..." before trusting the numbers.
//
// Run from admin/:
//   NODE_OPTIONS='--openssl-legacy-provider' node scripts/recipient-pin-cancel-stats.js

const fs = require('fs');
const path = require('path');

// Load .env.local
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

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const cutoffMs = Date.now() - NINETY_DAYS_MS;

// Cancellation-reason keywords that suggest an address / location issue
const ADDRESS_KEYWORDS = [
  'location', 'address', 'couldn', "can't reach", 'cant reach', 'no contact',
  'wrong', 'unable', 'pin', 'refused', 'refuse', 'rejected', 'reject',
  'gps', 'maps', 'navigate', 'unreachable', 'find', 'not respond',
];

function isAddressIssue(reason) {
  if (!reason) return false;
  const r = String(reason).toLowerCase();
  return ADDRESS_KEYWORDS.some((k) => r.includes(k));
}

function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  return null;
}

// Pin heuristic: addressComponents populated means a real geocoded result
// (vs just an area-centroid lat/lng that ships with set_address).
function hasPrecisePin(order) {
  const loc = order.recipient && order.recipient.location;
  if (!loc) return false;
  return Array.isArray(loc.addressComponents) && loc.addressComponents.length > 0;
}

function getPhoneCountry(order) {
  const r = (order && order.recipient) || {};
  if (r.recipientPhoneCountry) return r.recipientPhoneCountry;

  // Fallback: parse from the E.164 prefix so historical orders (where the
  // recipientPhoneCountry field wasn't being saved) still classify.
  const e164 = r.recipientPhoneE164 || '';
  if (typeof e164 === 'string') {
    if (e164.startsWith('+91')) return 'IN';
    if (e164.startsWith('+1')) return 'US';   // could be CA; intl for our purposes
    if (e164.startsWith('+44')) return 'GB';
    if (e164.startsWith('+971')) return 'AE';
    if (e164.startsWith('+65')) return 'SG';
    if (e164.startsWith('+61')) return 'AU';
    if (e164.startsWith('+')) return 'INTL';
  }

  // Last resort: legacy `recipientPhone` field (used before E.164). A bare
  // 10-digit string is almost certainly an IN number.
  const legacy = r.recipientPhone;
  if (legacy && /^\d{10}$/.test(String(legacy).replace(/\D/g, ''))) {
    return 'IN';
  }
  return null;
}

function pct(num, den) {
  if (!den) return '0.0%';
  return `${(num / den * 100).toFixed(1)}%`;
}

async function main() {
  if (!db) {
    console.error('Firestore not initialized - check FIREBASE_PRIVATE_KEY in .env.local');
    process.exit(1);
  }

  console.log(`\nCutoff for "last 90 days": ${new Date(cutoffMs).toISOString()}`);

  // ---- counters ----
  let totalOrders = 0;
  let inOrders = 0;
  let intlOrders = 0;
  let unknownPhoneOrders = 0;

  let pinIn = 0;
  let pinIntl = 0;
  let pinUnknown = 0;

  let cancelledTotal = 0;
  let cancelledIn = 0;
  let cancelledIntl = 0;
  let cancelledUnknown = 0;

  let cancelAddrTotal = 0;
  let cancelAddrIn = 0;
  let cancelAddrIntl = 0;
  let cancelAddrUnknown = 0;

  // Sample of address-issue cancellation reasons for the report
  const sampleReasons = [];

  // ---- iterate users + orders ----
  console.log('Fetching users...');
  const usersSnap = await db.collection('users').get();
  console.log(`Found ${usersSnap.size} users. Iterating order subcollections...\n`);

  let userIdx = 0;
  for (const userDoc of usersSnap.docs) {
    userIdx++;
    if (userIdx % 100 === 0) {
      process.stdout.write(`  ...processed ${userIdx}/${usersSnap.size} users (${totalOrders} orders so far)\n`);
    }

    let ordersSnap;
    try {
      ordersSnap = await userDoc.ref.collection('orders').get();
    } catch (e) {
      continue; // user without orders subcollection
    }

    for (const orderDoc of ordersSnap.docs) {
      const order = orderDoc.data();
      const ts = toMs(order.createdAt);
      if (!ts || ts < cutoffMs) continue;

      totalOrders++;

      const phoneCountry = getPhoneCountry(order);
      const isIn = phoneCountry === 'IN';
      const isIntl = phoneCountry && phoneCountry !== 'IN';
      const pin = hasPrecisePin(order);

      if (isIn) {
        inOrders++;
        if (pin) pinIn++;
      } else if (isIntl) {
        intlOrders++;
        if (pin) pinIntl++;
      } else {
        unknownPhoneOrders++;
        if (pin) pinUnknown++;
      }

      if (order.status === 'cancelled') {
        cancelledTotal++;
        const addr = isAddressIssue(order.cancellationReason);

        if (isIn) {
          cancelledIn++;
          if (addr) cancelAddrIn++;
        } else if (isIntl) {
          cancelledIntl++;
          if (addr) cancelAddrIntl++;
        } else {
          cancelledUnknown++;
          if (addr) cancelAddrUnknown++;
        }

        if (addr) {
          cancelAddrTotal++;
          if (sampleReasons.length < 12 && order.cancellationReason) {
            sampleReasons.push({
              country: phoneCountry || '?',
              reason: String(order.cancellationReason).slice(0, 120),
            });
          }
        }
      }
    }
  }

  // ---- report ----
  console.log('\n========== RESULTS ==========\n');

  console.log('Total orders in last 90 days:', totalOrders);
  console.log(`  IN phone:           ${inOrders}  (${pct(inOrders, totalOrders)})`);
  console.log(`  International:      ${intlOrders}  (${pct(intlOrders, totalOrders)})`);
  console.log(`  Unknown country:    ${unknownPhoneOrders}  (${pct(unknownPhoneOrders, totalOrders)})`);

  console.log('\n--- Q2: Pin coverage (recipient.location.addressComponents populated) ---');
  console.log(`  IN phone:           ${pinIn}/${inOrders}    (${pct(pinIn, inOrders)} have a precise pin)`);
  console.log(`  International:      ${pinIntl}/${intlOrders}    (${pct(pinIntl, intlOrders)} have a precise pin)`);
  console.log(`  Unknown country:    ${pinUnknown}/${unknownPhoneOrders}  (${pct(pinUnknown, unknownPhoneOrders)} have a precise pin)`);
  console.log(`  Overall:            ${pinIn + pinIntl + pinUnknown}/${totalOrders}  (${pct(pinIn + pinIntl + pinUnknown, totalOrders)} have a precise pin)`);

  console.log('\n--- Q1: Cancellations split by phone country ---');
  console.log(`  Total cancelled (last 90d): ${cancelledTotal}`);
  console.log(`    IN phone:          ${cancelledIn}  (${pct(cancelledIn, cancelledTotal)})`);
  console.log(`    International:     ${cancelledIntl}  (${pct(cancelledIntl, cancelledTotal)})`);
  console.log(`    Unknown country:   ${cancelledUnknown}  (${pct(cancelledUnknown, cancelledTotal)})`);
  console.log();
  console.log(`  Cancelled WITH address-issue keyword in reason: ${cancelAddrTotal}`);
  console.log(`    IN phone:          ${cancelAddrIn}  (${pct(cancelAddrIn, cancelAddrTotal)})`);
  console.log(`    International:     ${cancelAddrIntl}  (${pct(cancelAddrIntl, cancelAddrTotal)})`);
  console.log(`    Unknown country:   ${cancelAddrUnknown}  (${pct(cancelAddrUnknown, cancelAddrTotal)})`);

  if (cancelAddrTotal > 0) {
    console.log();
    console.log(`  >>> % of address-issue cancellations that involved an international phone: ${pct(cancelAddrIntl, cancelAddrTotal)}`);
  }

  if (sampleReasons.length) {
    console.log('\n--- Sample address-issue cancellation reasons (up to 12) ---');
    for (const s of sampleReasons) {
      console.log(`  [${s.country}] ${s.reason}`);
    }
  }

  console.log('\n=============================\n');
  process.exit(0);
}

main().catch((e) => {
  console.error('Script failed:', e);
  process.exit(1);
});
