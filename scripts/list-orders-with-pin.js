// One-off: dump orders that have a precise pin
// (recipient.location.addressComponents populated). Used to verify the
// D11 "Open in Maps" link in admin/pages/index.js by giving you the
// concrete order IDs that should render it.
//
// Run from admin/:
//   NODE_OPTIONS='--openssl-legacy-provider' node scripts/list-orders-with-pin.js

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

function hasPrecisePin(order) {
  const loc = order.recipient && order.recipient.location;
  if (!loc) return false;
  return (
    Array.isArray(loc.addressComponents) &&
    loc.addressComponents.length > 0 &&
    typeof loc.lat === 'number' &&
    typeof loc.lng === 'number'
  );
}

function shortCity(order) {
  const r = order.recipient || {};
  const loc = r.location || {};
  if (Array.isArray(loc.addressComponents)) {
    const get = (type) =>
      loc.addressComponents.find((x) => x.types?.includes(type))?.long_name || '';
    const city = get('locality') || get('administrative_area_level_2');
    if (city) return city;
  }
  if (loc.formattedAddress) {
    const parts = loc.formattedAddress.split(',').map((s) => s.trim()).filter(Boolean);
    return parts[Math.max(parts.length - 3, 0)] || '';
  }
  return '';
}

async function main() {
  if (!db) {
    console.error('Firestore not initialized - check FIREBASE_PRIVATE_KEY in .env.local');
    process.exit(1);
  }

  console.log('\nFetching all users + iterating orders for hasPrecisePin === true ...\n');
  const usersSnap = await db.collection('users').get();
  console.log(`Found ${usersSnap.size} users. Scanning ...\n`);

  const matches = [];
  let userIdx = 0;
  for (const userDoc of usersSnap.docs) {
    userIdx++;
    if (userIdx % 200 === 0) {
      process.stdout.write(`  scanned ${userIdx}/${usersSnap.size} users, ${matches.length} hits so far\n`);
    }
    let ordersSnap;
    try {
      ordersSnap = await userDoc.ref.collection('orders').get();
    } catch (e) {
      continue;
    }
    for (const orderDoc of ordersSnap.docs) {
      const order = orderDoc.data();
      if (!hasPrecisePin(order)) continue;
      const r = order.recipient || {};
      const loc = r.location || {};
      matches.push({
        userId: userDoc.id,
        orderId: orderDoc.id,
        createdAtMs: toMs(order.createdAt),
        createdAtIso: order.createdAt ? new Date(toMs(order.createdAt)).toISOString().slice(0, 10) : '?',
        recipientName: r.name || '?',
        phoneCountry: r.recipientPhoneCountry || (r.recipientPhoneE164?.startsWith('+91') ? 'IN' : '?'),
        city: shortCity(order),
        lat: loc.lat,
        lng: loc.lng,
        status: order.status || 'pending',
      });
    }
  }

  matches.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));

  console.log(`\n========== ${matches.length} orders with precise pin ==========\n`);
  const N = Math.min(10, matches.length);
  for (let i = 0; i < N; i++) {
    const m = matches[i];
    console.log(`[${i + 1}] ${m.createdAtIso} · ${m.status.padEnd(10)} · ${m.phoneCountry} · ${m.recipientName} -> ${m.city}`);
    console.log(`    userId  : ${m.userId}`);
    console.log(`    orderId : ${m.orderId}`);
    console.log(`    pin     : ${m.lat}, ${m.lng}`);
    console.log(`    maps    : https://www.google.com/maps?q=${m.lat},${m.lng}`);
    console.log();
  }
  if (matches.length > N) {
    console.log(`... and ${matches.length - N} more (showing top ${N} by recency)\n`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('Script failed:', e);
  process.exit(1);
});
