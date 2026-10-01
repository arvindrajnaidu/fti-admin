/**
 * Unit tests for the traveler dinner-recommendation email logic.
 * Run with:  npm test   (node --test, no jest needed)
 *
 * The libs under test are dependency-free CommonJS on purpose, so the Node
 * built-in test runner can require them with no transform step.
 * All names/emails/coords are fake fixtures - no real customer PII.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  DAY_MS,
  getOrderLatLng,
  orderIsDispatched,
  cooldownActive,
  lastSentAt,
  lastShownRestaurantIds,
  computePastFavorites,
  evaluateCandidate,
  findTravelerDinnerCandidates,
  buildSentMarker,
} = require('../lib/travelerDinnerEligibility');

const {
  DINNER_BUCKETS,
  buildRestaurantSearchUrl,
  buildRestaurantMenuUrl,
  buildSwiggyCardImageUrl,
  isRelevantForBucket,
  isDinnerWorthy,
  cuisineFocus,
  getPrimaryCuisine,
  parseRatingCount,
  isOpenNow,
  pickBestForBucket,
  toDinnerCard,
  toListingRow,
  getTravelerDinnerSelection,
} = require('../lib/travelerDinnerRestaurants');

const { buildTravelerDinnerEmailHtml, SUBJECT } = require('../lib/travelerDinnerEmailTemplate');
const { isWithinSendWindowIST } = require('../lib/travelerDinnerSend');

const NOW = 1_760_000_000_000;
const daysAgo = (d) => NOW - d * DAY_MS;

const travelerOrder = (o = {}) => ({
  order_intent: 'self_visiting',
  status: 'dispatched',
  createdAt: daysAgo(5),
  recipient: { location: { lat: 12.9796, lng: 77.7281 } },
  restaurantName: 'Test Kitchen',
  restaurantCity: 'Bengaluru',
  ...o,
});

const eligibleUser = (o = {}) => ({ email: 'traveler@example.test', displayName: 'Test Traveler', ...o });

const userSentHoursAgo = (h, extra = {}) => eligibleUser({
  lifecycleEmails: {
    travelerDinnerRecommendation: {
      sent: true,
      lastSentAt: NOW - h * 3600000,
      history: [{ sentAt: NOW - h * 3600000, orderId: 'ord_prev', channel: 'admin' }],
      ...extra,
    },
  },
});

const evalWith = (user, order, opts = {}) =>
  evaluateCandidate({ user, order, orderId: 'ord_1', now: NOW, ...opts });

// ── Eligibility ──────────────────────────────────────────────────────────────
describe('coordinates + dispatch state', () => {
  test('reads recipient.location.lat/lng; rejects 0,0 and junk', () => {
    assert.deepStrictEqual(getOrderLatLng({ recipient: { location: { lat: 1.5, lng: 2.5 } } }), { lat: 1.5, lng: 2.5 });
    assert.strictEqual(getOrderLatLng({ recipient: { location: { lat: 0, lng: 0 } } }), null);
    assert.strictEqual(getOrderLatLng({ recipient: { location: { lat: 'x', lng: 'y' } } }), null);
    assert.strictEqual(getOrderLatLng({}), null);
  });
  test('dispatched via status or dispatchedAt; cancelled/pending never', () => {
    assert.strictEqual(orderIsDispatched({ status: 'dispatched' }), true);
    assert.strictEqual(orderIsDispatched({ dispatchedAt: 123 }), true);
    assert.strictEqual(orderIsDispatched({ status: 'cancelled', dispatchedAt: 1 }), false);
    assert.strictEqual(orderIsDispatched({}), false);
  });
});

describe('eligibility', () => {
  test('accepts a dispatched traveler order in the 15d window', () => {
    const r = evalWith(eligibleUser(), travelerOrder());
    assert.strictEqual(r.eligible, true);
    assert.strictEqual(r.canSendNow, true);
    assert.strictEqual(r.lat, 12.9796);
  });
  test('skips pending / cancelled / non-traveler', () => {
    assert.strictEqual(evalWith(eligibleUser(), travelerOrder({ status: undefined })).reason, 'not dispatched (pending)');
    assert.strictEqual(evalWith(eligibleUser(), travelerOrder({ status: 'cancelled' })).reason, 'cancelled order');
    const r = evalWith(eligibleUser(), travelerOrder({
      order_intent: 'sending_to_india',
      recipient: { recipientRole: 'india_recipient', location: { lat: 12.9, lng: 77.7 } },
    }));
    assert.strictEqual(r.reason, 'not a traveler order');
  });
  test('accepts traveler via recipientRole alone', () => {
    const r = evalWith(eligibleUser(), travelerOrder({
      order_intent: undefined,
      recipient: { recipientRole: 'traveler', location: { lat: 12.9, lng: 77.7 } },
    }));
    assert.strictEqual(r.eligible, true);
  });
  test('includes same-day, excludes older than 15 days', () => {
    assert.strictEqual(evalWith(eligibleUser(), travelerOrder({ createdAt: daysAgo(0) })).eligible, true);
    assert.strictEqual(evalWith(eligibleUser(), travelerOrder({ createdAt: daysAgo(16) })).reason, 'too old (>window)');
  });
  test('skips unusable coords, no email, unsubscribed', () => {
    assert.strictEqual(evalWith(eligibleUser(), travelerOrder({ recipient: { location: { lat: 0, lng: 0 } } })).reason, 'no usable lat/lng');
    assert.strictEqual(evalWith(eligibleUser({ email: undefined }), travelerOrder()).reason, 'no sender email');
    assert.strictEqual(evalWith(eligibleUser({ emailPreferences: { unsubscribed: true } }), travelerOrder()).reason, 'unsubscribed');
  });
});

describe('2-day cadence', () => {
  test('cooldown within 2 days, clear after, legacy sentAt honoured', () => {
    assert.strictEqual(cooldownActive(userSentHoursAgo(10), NOW), true);
    assert.strictEqual(cooldownActive(userSentHoursAgo(60), NOW), false);
    assert.strictEqual(cooldownActive(eligibleUser(), NOW), false);
    const legacy = eligibleUser({ lifecycleEmails: { travelerDinnerRecommendation: { sent: true, sentAt: NOW - 3600000 } } });
    assert.strictEqual(lastSentAt(legacy), NOW - 3600000);
    assert.strictEqual(cooldownActive(legacy, NOW), true);
  });
  test('stays in cohort but not sendable during cooldown; sendable after', () => {
    const during = evalWith(userSentHoursAgo(10), travelerOrder());
    assert.strictEqual(during.eligible, true);
    assert.strictEqual(during.canSendNow, false);
    assert.strictEqual(during.sendCount, 1);
    assert.strictEqual(evalWith(userSentHoursAgo(60), travelerOrder()).canSendNow, true);
  });
});

describe('send marker / rotation persistence', () => {
  test('appends to history, updates lastSentAt/count, stores shown ids', () => {
    const existing = { history: [{ sentAt: daysAgo(3), orderId: 'ord_prev', channel: 'admin' }] };
    const m = buildSentMarker({
      existingMarker: existing, orderId: 'ord_1', lat: 1, lng: 2, sentAt: NOW,
      sentBy: 'santhosh', shownRestaurantIds: ['100', '200'],
    }).lifecycleEmails.travelerDinnerRecommendation;
    assert.strictEqual(m.lastSentAt, NOW);
    assert.strictEqual(m.count, 2);
    assert.deepStrictEqual(m.lastRestaurantIds, ['100', '200']);
    assert.deepStrictEqual(m.history[1].restaurantIds, ['100', '200']);
    assert.strictEqual(m.history[1].sentBy, 'santhosh');
  });
  test('caps history at 25', () => {
    const existing = { history: Array.from({ length: 25 }, (_, i) => ({ sentAt: i, orderId: `o${i}` })) };
    const m = buildSentMarker({ existingMarker: existing, orderId: 'newest', lat: 1, lng: 2, sentAt: NOW })
      .lifecycleEmails.travelerDinnerRecommendation;
    assert.strictEqual(m.history.length, 25);
    assert.strictEqual(m.history[24].orderId, 'newest');
  });
  test('lastShownRestaurantIds reads the marker (empty when absent)', () => {
    assert.deepStrictEqual(lastShownRestaurantIds(eligibleUser()), []);
    assert.deepStrictEqual(
      lastShownRestaurantIds(userSentHoursAgo(60, { lastRestaurantIds: ['7'] })),
      ['7']
    );
  });
});

// Minimal Firestore stub - proves latest-order selection without a live DB.
function fakeDb(users) {
  return {
    collection: () => ({
      where() { return this; },
      get: async () => ({
        size: users.length,
        docs: users.map((u) => ({
          id: u.uid,
          data: () => u.data,
          ref: {
            collection: () => ({
              orderBy() { return this; },
              limit() { return this; },
              get: async () => ({
                ...(u.readError ? (() => { throw u.readError; })() : {}),
                empty: u.orders.length === 0,
                docs: u.orders.length
                  ? [(() => {
                      const latest = [...u.orders].sort((a, b) => b.data.createdAt - a.data.createdAt)[0];
                      return { id: latest.id, data: () => latest.data };
                    })()]
                  : [],
              }),
            }),
          },
        })),
      }),
    }),
  };
}

describe('candidate scan', () => {
  test('uses the most recent order coords and annotates cooldown/history', async () => {
    const db = fakeDb([{
      uid: 'u1',
      data: userSentHoursAgo(10),
      orders: [
        { id: 'old', data: travelerOrder({ createdAt: daysAgo(9), recipient: { location: { lat: 1, lng: 1 } } }) },
        { id: 'new', data: travelerOrder({ createdAt: daysAgo(4), recipient: { location: { lat: 12.34, lng: 56.78 } } }) },
      ],
    }]);
    const { candidates } = await findTravelerDinnerCandidates({ db, now: NOW });
    assert.strictEqual(candidates.length, 1);
    assert.strictEqual(candidates[0].orderId, 'new');
    assert.strictEqual(candidates[0].lat, 12.34);
    assert.strictEqual(candidates[0].canSendNow, false);
    assert.strictEqual(candidates[0].history.length, 1);
  });
  test('one user\'s failed order read does not sink the scan (isolated as a skip)', async () => {
    // Regression: previously a single rejected read blew up the whole
    // Promise.all -> 500 on the candidates list and send-all aborting at 0.
    const db = fakeDb([
      {
        uid: 'broken',
        data: eligibleUser(),
        orders: [],
        readError: new Error('firestore unavailable'),
      },
      {
        uid: 'healthy',
        data: eligibleUser(),
        orders: [{ id: 'ok', data: travelerOrder({ createdAt: daysAgo(4) }) }],
      },
    ]);
    const { candidates, skipped } = await findTravelerDinnerCandidates({ db, now: NOW });
    assert.strictEqual(candidates.length, 1);
    assert.strictEqual(candidates[0].uid, 'healthy');
    assert.deepStrictEqual(skipped[0], { uid: 'broken', reason: 'read error' });
  });

  test('guest travelers are included via guestContact.email, flagged isGuest', () => {
    // Product decision 2026-07-24: the traveler ICP is largely guest checkout.
    const guest = evalWith(
      { guestContact: { email: 'guest@example.test', name: 'Guest Priya' } },
      travelerOrder()
    );
    assert.strictEqual(guest.eligible, true);
    assert.strictEqual(guest.email, 'guest@example.test');
    assert.strictEqual(guest.isGuest, true);
    assert.strictEqual(guest.senderName, 'Guest Priya');
    // Signed-in users are not flagged
    assert.strictEqual(evalWith(eligibleUser(), travelerOrder()).isGuest, false);
  });

  test('send window: IST dinner hours only', () => {
    // 2026-07-24 12:00 UTC = 17:30 IST (inside 16-21)
    const utcNoon = Date.UTC(2026, 6, 24, 12, 0);
    assert.strictEqual(isWithinSendWindowIST(utcNoon, 16, 21), true);
    // 20:00 UTC = 01:30 IST next day (outside)
    assert.strictEqual(isWithinSendWindowIST(Date.UTC(2026, 6, 24, 20, 0), 16, 21), false);
    // 07:00 UTC = 12:30 IST (outside)
    assert.strictEqual(isWithinSendWindowIST(Date.UTC(2026, 6, 24, 7, 0), 16, 21), false);
    // boundary: 15:30 UTC = 21:00 IST exactly -> excluded (end-exclusive)
    assert.strictEqual(isWithinSendWindowIST(Date.UTC(2026, 6, 24, 15, 30), 16, 21), false);
    // 10:30 UTC = 16:00 IST exactly -> included (start-inclusive)
    assert.strictEqual(isWithinSendWindowIST(Date.UTC(2026, 6, 24, 10, 30), 16, 21), true);
  });

  test('senderName fallback strips the [Risk Score] suffix', () => {
    const r = evalWith(
      eligibleUser({ displayName: undefined }),
      travelerOrder({ senderName: 'Priya Sharma [Risk Score: 2, Country US]' })
    );
    assert.strictEqual(r.senderName, 'Priya Sharma');
  });

  test('skips a user whose latest order is not a traveler order', async () => {
    const db = fakeDb([{
      uid: 'u2',
      data: eligibleUser(),
      orders: [{ id: 'latest', data: travelerOrder({
        createdAt: daysAgo(3),
        order_intent: 'sending_to_india',
        recipient: { recipientRole: 'india_recipient', location: { lat: 5, lng: 5 } },
      }) }],
    }]);
    const { candidates, skipped } = await findTravelerDinnerCandidates({ db, now: NOW });
    assert.strictEqual(candidates.length, 0);
    assert.strictEqual(skipped[0].reason, 'not a traveler order');
  });
});

// ── Restaurants / selection ──────────────────────────────────────────────────
const rest = (o = {}) => ({
  id: o.id ?? 1,
  name: o.name ?? 'Biryani House',
  cloudinaryImageId: 'img' in o ? o.img : 'abc123',
  avgRating: o.rating ?? '4.2',
  deliveryTime: o.eta ?? 30,
  totalRatingsString: o.pop ?? '1K+',
  availability: 'open' in o ? { opened: o.open } : { opened: true },
  cuisine: o.cuisine ?? ['Biryani'],
});
const biryaniBucket = DINNER_BUCKETS.find((b) => b.key === 'biryani');
const chineseBucket = DINNER_BUCKETS.find((b) => b.key === 'chinese');
const fastfoodBucket = DINNER_BUCKETS.find((b) => b.key === 'fastfood');

describe('link generation (menu deep links)', () => {
  test('card + row links go to the restaurant MENU, not a category search', () => {
    const url = buildRestaurantMenuUrl({ restaurantId: '1275849', lat: 12.9796, lng: 77.7281 });
    assert.ok(url.startsWith('https://www.foodtoindia.com/orders/create?restaurantId=1275849&lat=12.9796&lng=77.7281&source=traveler_dinner_email'));
  });
  test('browse link keeps the search page with source', () => {
    const url = buildRestaurantSearchUrl({ lat: 1, lng: 2 });
    assert.ok(url.startsWith('https://www.foodtoindia.com/orders/restaurants?'));
    assert.ok(url.includes('source=traveler_dinner_email'));
  });
  test('image url is the w_640 transform', () => {
    assert.strictEqual(buildSwiggyCardImageUrl('xyz'), 'https://media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_640/xyz');
    assert.strictEqual(buildSwiggyCardImageUrl(null), null);
  });
  test('image id is sanitized - attribute-breaking chars cannot reach the email', () => {
    // Adversarial M1: imageId is Swiggy-controlled and lands in <img src="...">.
    const url = buildSwiggyCardImageUrl('abc" onerror="x() <b>');
    assert.ok(!url.includes('"') && !url.includes('<') && !url.includes(' '));
    assert.ok(url.endsWith('/abconerrorxb'));
    // Stripping leaves only inert characters; what remains is a harmless 404,
    // never markup.
    const stripped = buildSwiggyCardImageUrl('"><script>');
    assert.ok(!stripped.includes('<') && !stripped.includes('>') && !stripped.includes('"'));
  });
  test('every link carries UTM params alongside source', () => {
    for (const url of [
      buildRestaurantMenuUrl({ restaurantId: '1', lat: 1, lng: 2 }),
      buildRestaurantSearchUrl({ lat: 1, lng: 2 }),
    ]) {
      assert.ok(url.includes('utm_source=traveler_dinner_email'), url);
      assert.ok(url.includes('utm_medium=email'), url);
      assert.ok(url.includes('source=traveler_dinner_email'), url);
    }
  });
  test('toDinnerCard: own-cuisine label, "Order now" CTA, menu link with own id', () => {
    const card = toDinnerCard(rest({ id: 7, name: 'Mehfil', cuisine: ['North Indian', 'Biryani'] }), chineseBucket, { lat: 1, lng: 2 });
    assert.strictEqual(card.cuisineLabel, 'North Indian'); // its OWN primary cuisine
    assert.strictEqual(card.linkLabel, 'Order now');
    assert.ok(card.orderUrl.includes('/orders/create?restaurantId=7'));
  });
  test('toListingRow links to the menu too', () => {
    const row = toListingRow(rest({ id: 9, name: 'Empire', cuisine: ['Biryani', 'Kebabs', 'Grill'] }), { lat: 1, lng: 2 });
    assert.strictEqual(row.cuisineLabel, 'Biryani, Kebabs');
    assert.ok(row.orderUrl.includes('restaurantId=9'));
  });
});

describe('dinner-worthiness gate (no sweets/snacks in a dinner email)', () => {
  // Real cases flagged 2026-07-24: sweet shops and snack counters rank well on
  // rating x popularity and were surfacing in "A few more".
  test('sweet shops and snack-primary places are excluded', () => {
    assert.strictEqual(isDinnerWorthy(rest({ name: 'Bengal Sweet Corner', cuisine: ['Sweets', 'Snacks'] })), false);
    assert.strictEqual(isDinnerWorthy(rest({ name: 'Moolchand Parantha', cuisine: ['Snacks', 'Chinese'] })), false);
    assert.strictEqual(isDinnerWorthy(rest({ name: 'Evergreen Sweet House', cuisine: ['North Indian', 'South Indian'] })), false);
    assert.strictEqual(isDinnerWorthy(rest({ name: 'Corner House Ice Cream', cuisine: ['Desserts'] })), false);
  });
  test('real dinner places with Sweets as a SECONDARY cuisine stay in', () => {
    assert.strictEqual(isDinnerWorthy(rest({ name: 'A2B - Adyar Ananda Bhavan', cuisine: ['South Indian', 'Sweets'] })), true);
    assert.strictEqual(isDinnerWorthy(rest({ name: 'Biryani Blues', cuisine: ['Biryani'] })), true);
  });
  test('non-dinner places are excluded from cards AND the also-pool', async () => {
    const sweetChinese = rest({ id: 1, name: 'Moolchand Parantha', rating: '4.6', eta: 15, cuisine: ['Snacks', 'Chinese'] });
    const realChinese = rest({ id: 2, name: 'Wok Express', rating: '4.0', eta: 30, cuisine: ['Chinese'] });
    const sweetShop = rest({ id: 3, name: 'Bengal Sweet Corner', rating: '4.8', eta: 10, cuisine: ['Sweets'] });
    const sel = await getTravelerDinnerSelection({
      lat: 1, lng: 2,
      search: async ({ searchText }) => (searchText === 'chinese' ? [sweetChinese, realChinese, sweetShop] : []),
    });
    assert.strictEqual(sel.cards[0].id, '2'); // the real Chinese place wins the card
    assert.ok(!sel.shownIds.includes('1'));
    assert.ok(!sel.shownIds.includes('3')); // sweet shop kept out of "A few more" too
  });
});

describe('relevance gate + focus (photo-honesty rankings)', () => {
  test('a Mexican place never fills the chinese slot', () => {
    const burrito = rest({ id: 1, name: 'California Burrito', rating: '4.6', eta: 12, cuisine: ['Mexican'] });
    assert.strictEqual(isRelevantForBucket(burrito, chineseBucket), false);
    assert.strictEqual(pickBestForBucket([burrito], chineseBucket), null);
  });
  test('focused specialist beats a generalist that merely lists the cuisine', () => {
    const generalist = rest({
      id: 1, name: 'Mehfil', rating: '4.6', eta: 20,
      cuisine: ['North Indian', 'Biryani', 'Pan-Asian', 'Continental', 'Desserts', 'Asian', 'Beverages', 'Chinese', 'European'],
    });
    const focused = rest({ id: 2, name: 'Beijing Bites', rating: '4.2', eta: 25, cuisine: ['Chinese', 'Thai'] });
    assert.ok(cuisineFocus(focused, chineseBucket) > cuisineFocus(generalist, chineseBucket));
    assert.strictEqual(pickBestForBucket([generalist, focused], chineseBucket).id, 2);
  });
  test('name stating the craving = max focus; brand names count for fast food', () => {
    assert.strictEqual(cuisineFocus(rest({ name: 'Raju Gari Biryani', cuisine: ['Chinese'] }), biryaniBucket), 1);
    assert.strictEqual(isRelevantForBucket(rest({ name: 'KFC', cuisine: ['Burgers'] }), fastfoodBucket), true);
    assert.strictEqual(isRelevantForBucket(rest({ name: 'Random Grill', cuisine: ['Burgers'] }), fastfoodBucket), false);
  });
  test('closed restaurants are excluded; missing availability is not "closed"', () => {
    assert.strictEqual(isOpenNow(rest({ open: false })), false);
    assert.strictEqual(isOpenNow(rest({ open: true })), true);
    assert.strictEqual(isOpenNow({ id: 1 }), true);
    assert.strictEqual(pickBestForBucket([rest({ id: 5, open: false })], biryaniBucket), null);
  });
  test('popularity parsing: 107K+ -> 107000', () => {
    assert.strictEqual(parseRatingCount('107K+'), 107000);
    assert.strictEqual(parseRatingCount('325'), 325);
    assert.strictEqual(parseRatingCount(null), 0);
  });
  test('requires an image', () => {
    assert.strictEqual(pickBestForBucket([rest({ id: 9, img: undefined })], biryaniBucket), null);
  });
});

describe('selection: dedupe, pools, rotation', () => {
  const search = (byQuery) => async ({ searchText }) => byQuery[searchText] || [];

  test('dedupes across buckets; also-delivering excludes card picks', async () => {
    const shared = rest({ id: 100, name: 'Combo Biryani House', rating: '4.9', eta: 15, cuisine: ['Biryani', 'Pizza'] });
    const pizzaAlt = rest({ id: 200, name: 'Pizza Alt', rating: '4.0', eta: 30, cuisine: ['Pizza'] });
    const extra = rest({ id: 300, name: 'Biryani Extra', rating: '4.1', eta: 25 });
    const sel = await getTravelerDinnerSelection({
      lat: 1, lng: 2,
      search: search({ biryani: [shared, extra], pizza: [shared, pizzaAlt] }),
    });
    const cardIds = sel.cards.map((c) => c.id);
    assert.deepStrictEqual(new Set(cardIds).size, cardIds.length);
    assert.ok(cardIds.includes('100'));
    assert.ok(cardIds.includes('200'));
    // extra didn't make a card, so it lands in the text rows
    assert.ok(sel.alsoDelivering.some((r) => r.id === '300'));
    assert.ok(!sel.alsoDelivering.some((r) => cardIds.includes(r.id)));
    assert.deepStrictEqual(sel.shownIds.sort(), ['100', '200', '300'].sort());
  });

  test('rotation: excludeIds picks a different card when an alternative exists', async () => {
    const a = rest({ id: 1, name: 'Biryani A', rating: '4.6', eta: 20 });
    const b = rest({ id: 2, name: 'Biryani B', rating: '4.4', eta: 25 });
    const s = search({ biryani: [a, b] });
    const first = await getTravelerDinnerSelection({ lat: 1, lng: 2, search: s });
    assert.strictEqual(first.cards[0].id, '1');
    const second = await getTravelerDinnerSelection({ lat: 1, lng: 2, search: s, excludeIds: ['1'] });
    assert.strictEqual(second.cards[0].id, '2');
  });

  test('rotation falls back to the excluded best rather than dropping the card', async () => {
    const only = rest({ id: 1, name: 'Only Biryani', rating: '4.6', eta: 20 });
    const sel = await getTravelerDinnerSelection({ lat: 1, lng: 2, search: search({ biryani: [only] }), excludeIds: ['1'] });
    assert.strictEqual(sel.cards[0].id, '1');
  });

  test('a bucket with no relevant result yields no card rather than a wrong one', async () => {
    const sel = await getTravelerDinnerSelection({
      lat: 1, lng: 2,
      search: search({ chinese: [rest({ id: 9, name: 'California Burrito', cuisine: ['Mexican'] })] }),
    });
    assert.deepStrictEqual(sel.cards, []);
  });

  test('one bucket search throwing does not sink the others', async () => {
    const s = async ({ searchText }) => {
      if (searchText === 'biryani') throw new Error('boom');
      if (searchText === 'pizza') return [rest({ id: 5, name: 'Pizza Hub', cuisine: ['Pizza'] })];
      return [];
    };
    const sel = await getTravelerDinnerSelection({ lat: 1, lng: 2, search: s });
    assert.deepStrictEqual(sel.cards.map((c) => c.bucketKey), ['pizza']);
  });
});

describe('quality floors + brand dedupe + dead images', () => {
  const search = (byQuery) => async ({ searchText }) => byQuery[searchText] || [];

  test('a weak rating never makes a card', () => {
    const weak = rest({ id: 1, name: 'Weak Biryani', rating: '3.2', eta: 15 });
    const solid = rest({ id: 2, name: 'Solid Biryani', rating: '4.0', eta: 30 });
    assert.strictEqual(pickBestForBucket([weak, solid], biryaniBucket).id, 2);
    assert.strictEqual(pickBestForBucket([weak], biryaniBucket), null);
  });

  test('an absurd ETA never makes a card', () => {
    assert.strictEqual(pickBestForBucket([rest({ id: 1, eta: 120 })], biryaniBucket), null);
  });

  test('one brand appears once across the whole email (chain outlets deduped)', async () => {
    const bkA = rest({ id: 1, name: 'Burger King - Koramangala', rating: '4.4', eta: 20, cuisine: ['Burgers'] });
    const bkB = rest({ id: 2, name: 'Burger King - Indiranagar', rating: '4.3', eta: 25, cuisine: ['Burgers'] });
    const sel = await getTravelerDinnerSelection({
      lat: 1, lng: 2,
      search: search({ 'KFC': [], "McDonald's": [], 'Burger King': [bkA, bkB], restaurant: [bkB] }),
    });
    const names = [...sel.cards, ...sel.alsoDelivering].map((x) => x.name);
    assert.strictEqual(names.filter((n) => n.startsWith('Burger King')).length, 1);
  });

  test('a dead image walks down to the next candidate instead of sending broken', async () => {
    // Real case: "Chilli n Chine" card rendered as broken alt text - the
    // imageId existed but the CDN file was gone.
    const dead = rest({ id: 1, name: 'Chilli n Chine Biryani', rating: '4.6', eta: 15, img: 'deadfile' });
    const alive = rest({ id: 2, name: 'Live Biryani', rating: '4.0', eta: 30, img: 'livefile' });
    const sel = await getTravelerDinnerSelection({
      lat: 1, lng: 2,
      search: search({ biryani: [dead, alive] }),
      verifyImage: async (url) => !url.includes('deadfile'),
    });
    assert.strictEqual(sel.cards.length, 1);
    assert.strictEqual(sel.cards[0].id, '2');
  });
});

describe('past-order favorites ("Order again")', () => {
  const HYD = { lat: 17.418, lng: 78.342 };
  const pastOrder = (o = {}) => ({
    restaurantId: o.rid, restaurantName: o.name, status: o.status || 'dispatched',
    createdAt: o.at || 1_760_000_000_000,
    recipient: { location: { lat: o.lat ?? HYD.lat, lng: o.lng ?? HYD.lng } },
  });

  test('groups repeats near the trip location; excludes far cities, cancellations, one-timers', () => {
    const favs = computePastFavorites([
      pastOrder({ rid: '100', name: 'Wow! Momo' }),
      pastOrder({ rid: '100', name: 'Wow! Momo' }),
      pastOrder({ rid: '200', name: 'One Time Pizza' }),                    // only once
      pastOrder({ rid: '300', name: 'Home City Fav', lat: 19.07, lng: 72.88 }), // Mumbai, far
      pastOrder({ rid: '300', name: 'Home City Fav', lat: 19.07, lng: 72.88 }),
      pastOrder({ rid: '400', name: 'Cancelled Cafe', status: 'cancelled' }),
      pastOrder({ rid: '400', name: 'Cancelled Cafe', status: 'cancelled' }),
    ], HYD);
    assert.deepStrictEqual(favs, [{ restaurantId: '100', name: 'Wow! Momo', count: 2 }]);
  });

  test('favorites become "Order again" rows only when the live pool confirms them', async () => {
    const momo = rest({ id: 100, name: 'Wow! Momo', rating: '4.3', eta: 20, cuisine: ['Momos'] });
    const sel = await getTravelerDinnerSelection({
      lat: 1, lng: 2,
      search: async ({ searchText }) => (searchText === 'restaurant' ? [momo] : []),
      pastFavorites: [
        { restaurantId: '100', name: 'Wow! Momo', count: 2 },
        { restaurantId: '999', name: 'Vanished Restaurant', count: 3 }, // not in pool
      ],
    });
    assert.strictEqual(sel.reorderRows.length, 1);
    assert.deepStrictEqual(
      { id: sel.reorderRows[0].id, count: sel.reorderRows[0].count },
      { id: '100', count: 2 }
    );
    assert.ok(sel.reorderRows[0].orderUrl.includes('restaurantId=100'));
    // and it must not ALSO appear in "A few more"
    assert.ok(!sel.alsoDelivering.some((r) => r.id === '100'));
  });
});

// ── Email template ───────────────────────────────────────────────────────────
const sampleCards = [{
  id: '1', name: 'Biryani Blues', bucketKey: 'biryani', cuisineLabel: 'Biryani',
  ratingLabel: '3.9', etaLabel: '15-20 min', imageUrl: 'https://media-assets.swiggy.com/x/img1',
  linkLabel: 'Order now',
  orderUrl: 'https://www.foodtoindia.com/orders/create?restaurantId=1&lat=12.9796&lng=77.7281&source=traveler_dinner_email',
}];
const sampleRows = [{
  id: '9', name: 'Empire Restaurant', cuisineLabel: 'Biryani, Kebabs',
  orderUrl: 'https://www.foodtoindia.com/orders/create?restaurantId=9&lat=12.9796&lng=77.7281&source=traveler_dinner_email',
}];
const buildHtml = (over = {}) => buildTravelerDinnerEmailHtml({
  senderName: 'Gustavo Fring', senderEmail: 'gustavo@example.test',
  lat: 12.9796, lng: 77.7281, cards: sampleCards, alsoDelivering: sampleRows, ...over,
});

describe('email template', () => {
  test('subject is the approved line', () => {
    assert.strictEqual(SUBJECT, "What's for dinner tonight?");
  });
  test('greets by first name; lone initial falls back', () => {
    assert.ok(buildHtml().includes('Gustavo, take your pick.'));
    assert.ok(buildHtml({ senderName: 'H.' }).includes('there, take your pick.'));
  });
  test('preheader count matches the cards actually shown', () => {
    assert.ok(buildHtml().includes('1 restaurant delivering to you right now.'));
    assert.ok(buildHtml({ cards: [...sampleCards, { ...sampleCards[0], id: '2' }] })
      .includes('2 restaurants delivering to you right now.'));
  });
  test('cards and rows link to menus; browse CTA present', () => {
    const html = buildHtml();
    assert.ok(html.includes('restaurantId=1'));
    assert.ok(html.includes('Order now'));
    assert.ok(html.includes('Empire Restaurant'));
    assert.ok(html.includes('restaurantId=9'));
    assert.ok(html.includes('Browse restaurants'));
    assert.ok(html.includes("Schedule tomorrow's meal"));
  });
  test('unsubscribe link present', () => {
    assert.ok(buildHtml().includes('unsubscribe?email=gustavo%40example.test'));
  });
  test('no hotel/address/stay wording, no proposition re-pitch, no em-dashes', () => {
    const html = buildHtml();
    const lower = html.toLowerCase();
    for (const banned of ['hotel', 'near your', 'your stay', 'your address', 'international number', 'indian number']) {
      assert.ok(!lower.includes(banned), `email must not contain "${banned}"`);
    }
    assert.ok(!html.includes('—') && !html.includes('–'), 'no em/en dashes');
  });
  test('also-delivering section omitted cleanly when empty', () => {
    const html = buildHtml({ alsoDelivering: [] });
    assert.ok(!html.includes('A few more'));
  });
  test('"Order again" section renders with crisp count phrasing, omitted when empty', () => {
    const rows = [{ id: '100', name: 'Wow! Momo', count: 2, orderUrl: 'https://www.foodtoindia.com/orders/create?restaurantId=100&lat=1&lng=2&source=traveler_dinner_email' }];
    const html = buildHtml({ reorderRows: rows });
    assert.ok(html.includes('Order again'));
    assert.ok(html.includes("you've ordered here twice"));
    assert.ok(html.includes('restaurantId=100'));
    const html3 = buildHtml({ reorderRows: [{ ...rows[0], count: 3 }] });
    assert.ok(html3.includes("you've ordered here 3 times"));
    assert.ok(!buildHtml().includes('Order again'));
  });
  test('long restaurant names are clamped for display', () => {
    const longName = 'Radhe Dhokla-(Punjabi, Chinese, Thali & Biryani) Extra Long';
    const html = buildHtml({ cards: [{ ...sampleCards[0], name: longName }] });
    assert.ok(!html.includes(longName));
    assert.ok(html.includes('...'));
  });
});
