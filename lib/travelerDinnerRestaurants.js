// Restaurant selection for the traveler dinner-recommendation email (admin app).
//
// The admin can't reach Swiggy directly, so it calls foodtoindia's ALREADY-PUBLIC
// /api/search endpoint (no auth) for each craving bucket, then filters/ranks here.
//
// Selection model (hybrid):
//   - The 4 craving buckets exist ONLY to guarantee variety in the card row
//     (a biryani, a pizza, a Chinese, a fast-food place).
//   - Every card is then labelled with the restaurant's OWN primary cuisine, and
//     its CTA links to that cuisine. We never impose a craving label on a
//     restaurant. This matters because the card photo is the restaurant's own
//     marketing banner and Swiggy exposes NO description of its contents - so the
//     only way a photo can never contradict the label is to take the label from
//     the restaurant itself. (Real bug this prevents: "Mehfil", which lists
//     Chinese 8th of 9 cuisines, showed its bestselling biryani on a card that
//     said "Order Chinese".)
//   - A separate pool feeds the 5 text-only "Also delivering tonight" rows.
//   - `excludeIds` (the previous send's picks) rotates the selection so two
//     consecutive emails never show the same cards.

const SEARCH_SOURCE = 'traveler_dinner_email';
const APP_ORIGIN = 'https://www.foodtoindia.com';

const CARD_COUNT = 4;
const ALSO_COUNT = 5;
// How deep to consider per bucket when rotating away from the last send.
const ROTATION_POOL = 4;

// `queries` are sent to Swiggy search. `matchTerms` are what a result must
// actually contain (name or cuisines) to belong in that bucket - Swiggy's search
// is fuzzy and will happily return a Mexican place for "chinese".
const DINNER_BUCKETS = [
  { key: 'biryani',  label: 'Biryani',   queries: ['biryani'], matchTerms: ['biryani'] },
  { key: 'pizza',    label: 'Pizza',     queries: ['pizza'],   matchTerms: ['pizza'] },
  { key: 'chinese',  label: 'Chinese',   queries: ['chinese'], matchTerms: ['chinese'] },
  { key: 'fastfood', label: 'Fast food', queries: ['KFC', "McDonald's", 'Burger King'], matchTerms: ['kfc', 'mcdonald', 'burger king'] },
];

// ── Field accessors (Swiggy search/v3 is flat) ───────────────────────────────
const getRestaurantId = (r) => (r && r.id != null ? String(r.id) : null);
const getRestaurantName = (r) => (r && r.name ? String(r.name) : '');
const getRestaurantRating = (r) => {
  const v = Number(r?.avgRating ?? r?.avgRatingString ?? r?.sla?.rating);
  return Number.isFinite(v) ? v : null;
};
const getRestaurantEtaMin = (r) => {
  const v = Number(
    r?.sla?.deliveryTime ?? r?.deliveryTime ??
    r?.sla?.maxDeliveryTime ?? r?.maxDeliveryTime ??
    r?.sla?.minDeliveryTime ?? r?.minDeliveryTime
  );
  return Number.isFinite(v) ? v : null;
};
const getRestaurantImageId = (r) => (r && r.cloudinaryImageId ? String(r.cloudinaryImageId) : null);
const getRestaurantCuisines = (r) => {
  if (Array.isArray(r?.cuisines)) return r.cuisines;
  if (Array.isArray(r?.cuisine)) return r.cuisine;
  return [];
};
const getRestaurantSlaLabel = (r) => {
  const min = Number(r?.sla?.minDeliveryTime ?? r?.minDeliveryTime);
  const max = Number(r?.sla?.maxDeliveryTime ?? r?.maxDeliveryTime);
  if (Number.isFinite(min) && Number.isFinite(max) && min !== max) return `${min}-${max} min`;
  const eta = getRestaurantEtaMin(r);
  return eta != null ? `${eta} min` : null;
};

/** Only exclude when Swiggy explicitly says closed; missing data is not "closed". */
const isOpenNow = (r) => r?.availability?.opened !== false;

/** "107K+" -> 107000, "1.2K" -> 1200, "325" -> 325. Popularity signal. */
function parseRatingCount(value) {
  if (value == null) return 0;
  const s = String(value).trim().toLowerCase().replace(/\+/g, '');
  const m = s.match(/([\d.]+)\s*([km]?)/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return 0;
  if (m[2] === 'k') return Math.round(n * 1000);
  if (m[2] === 'm') return Math.round(n * 1000000);
  return Math.round(n);
}
const getRestaurantRatingCount = (r) => parseRatingCount(r?.totalRatingsString);

/** The restaurant's own primary cuisine - the single source for card labels. */
const getPrimaryCuisine = (r) => {
  const c = getRestaurantCuisines(r);
  return c.length > 0 ? String(c[0]) : null;
};

// Dinner email = dinner food. Sweet shops, dessert parlours, bakeries and
// snack counters rank well on rating x popularity and were surfacing in the
// "A few more" rows (real case: "Bengal Sweet Corner", "Moolchand Parantha -
// Snacks"). Exclude when their PRIMARY identity is non-dinner - a real dinner
// restaurant that merely lists Sweets as a secondary cuisine (e.g. "A2B -
// South Indian, Sweets") stays in.
const NON_DINNER_PRIMARY = ['sweet', 'dessert', 'bakery', 'cake', 'ice cream', 'snack', 'beverage', 'juice', 'paan'];
const NON_DINNER_NAME = ['sweet', 'bakery', 'cake', 'dessert', 'mithai', 'ice cream', 'juice'];

function isDinnerWorthy(r) {
  const primary = String(getPrimaryCuisine(r) || '').toLowerCase();
  if (NON_DINNER_PRIMARY.some((t) => primary.includes(t))) return false;
  const name = getRestaurantName(r).toLowerCase();
  if (NON_DINNER_NAME.some((t) => name.includes(t))) return false;
  return true;
}

// ── URLs ─────────────────────────────────────────────────────────────────────
// imageId is a Swiggy-controlled string that ends up inside an <img src="...">
// attribute in a customer email. Strip anything outside the charset real
// Cloudinary ids use (letters, digits, /_-.,) so a hostile/corrupt id can't
// break out of the attribute (the template also esc()s the final URL).
const buildSwiggyCardImageUrl = (imageId) => {
  if (!imageId) return null;
  const safeId = String(imageId).replace(/[^A-Za-z0-9/_.,-]/g, '');
  if (!safeId) return null;
  return `https://media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_640/${safeId}`;
};

// UTM params on every link (analytics standing rule) alongside the app-level
// `source` param, so email -> order funnels can be measured from history.
const appendUtm = (params) => {
  params.set('utm_source', 'traveler_dinner_email');
  params.set('utm_medium', 'email');
  params.set('utm_campaign', 'traveler_dinner');
};

// `origin` exists ONLY so TEST sends can point links at a local/stage
// foodtoindia that already has the menu deep-link code. Real sends and previews
// never pass it, so customers always get production links.
function buildRestaurantSearchUrl({ lat, lng, category, area, source = SEARCH_SOURCE, origin = APP_ORIGIN }) {
  const params = new URLSearchParams();
  params.set('lat', String(lat));
  params.set('lng', String(lng));
  if (category) params.set('category', category);
  if (area) params.set('area', String(area));
  params.set('source', source);
  appendUtm(params);
  return `${origin}/orders/restaurants?${params.toString()}`;
}

/**
 * Direct link to ONE restaurant's menu (/orders/create deep link, verified
 * working logged-out). Every card and text row uses this - the email shows a
 * specific restaurant, so landing on a category list would be a bait-and-switch.
 * Category browsing stays available via "See all restaurants".
 */
function buildRestaurantMenuUrl({ restaurantId, lat, lng, area, source = SEARCH_SOURCE, origin = APP_ORIGIN }) {
  const params = new URLSearchParams();
  params.set('restaurantId', String(restaurantId));
  params.set('lat', String(lat));
  params.set('lng', String(lng));
  if (area) params.set('area', String(area));
  params.set('source', source);
  appendUtm(params);
  return `${origin}/orders/create?${params.toString()}`;
}

// ── Bucket relevance (a GATE) ────────────────────────────────────────────────
const bucketMatchTerms = (bucket) => (bucket.matchTerms || bucket.queries || []).map((t) => String(t).toLowerCase());

function isRelevantForBucket(restaurant, bucket) {
  const terms = bucketMatchTerms(bucket);
  if (terms.length === 0) return true;
  const name = getRestaurantName(restaurant).toLowerCase();
  const cuisines = getRestaurantCuisines(restaurant).map((c) => String(c).toLowerCase());
  return terms.some((t) => name.includes(t) || cuisines.some((c) => c.includes(t)));
}

/** How central the craving is to this restaurant (0-1). Favours specialists,
 *  whose banner photo will actually show that food. */
function cuisineFocus(restaurant, bucket) {
  const terms = bucketMatchTerms(bucket);
  const name = getRestaurantName(restaurant).toLowerCase();
  if (terms.some((t) => name.includes(t))) return 1;

  const cuisines = getRestaurantCuisines(restaurant).map((c) => String(c).toLowerCase());
  const idx = cuisines.findIndex((c) => terms.some((t) => c.includes(t)));
  if (idx === -1) return 0.2;

  const positionNorm = 1 - Math.min(idx, 4) / 5;
  const focusNorm = clamp01(1 - (cuisines.length - 1) / 8);
  return clamp01(0.6 * positionNorm + 0.4 * focusNorm);
}

// ── Ranking (pure) ───────────────────────────────────────────────────────────
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
const ratingNorm = (rating) => (rating == null ? 0.5 : clamp01(rating / 5));
const etaNorm = (eta) => (eta == null ? 0.4 : clamp01(1 - (eta - 15) / 45));
// Log scale: 100 ratings is meaningfully better than 5; 100K vs 50K barely matters.
const popularityNorm = (count) => clamp01(Math.log10((count || 0) + 1) / 5);

const RATING_WEIGHT = 0.30;
const ETA_WEIGHT = 0.30;
const FOCUS_WEIGHT = 0.30;
const POPULARITY_WEIGHT = 0.10;

function scoreRestaurant(restaurant, bucket) {
  return (
    RATING_WEIGHT * ratingNorm(getRestaurantRating(restaurant)) +
    ETA_WEIGHT * etaNorm(getRestaurantEtaMin(restaurant)) +
    FOCUS_WEIGHT * cuisineFocus(restaurant, bucket) +
    POPULARITY_WEIGHT * popularityNorm(getRestaurantRatingCount(restaurant))
  );
}

/** Rating x popularity, for the text-only "also delivering" rows (no bucket). */
function scoreForListing(restaurant) {
  return 0.7 * ratingNorm(getRestaurantRating(restaurant)) +
         0.3 * popularityNorm(getRestaurantRatingCount(restaurant));
}

// Quality floors: a dinner recommendation must not carry a visibly weak rating
// or an absurd wait. Unknown values pass (small towns often lack data) - the
// score already penalises them.
const MIN_RATING = 3.5;
const MAX_ETA_MIN = 90;
// The consumer app rejects any restaurant more than MAX_RESTAURANT_DISTANCE_KM
// (10km) from the delivery address with a 400, so a recommendation beyond that
// is a dead link. Swiggy's sla.lastMileTravel is road distance (>= straight
// line), so <= 10 here guarantees the app's radius check passes. Kept in sync
// with foodtoindia/lib/restaurantDistance.js MAX_RESTAURANT_DISTANCE_KM.
const MAX_DELIVERY_KM = 10;

// Swiggy's per-restaurant distance from the delivery point ("5.9 km away").
const getRestaurantDistanceKm = (r) => {
  const d = Number(r?.sla?.lastMileTravel);
  return Number.isFinite(d) ? d : null;
};

const meetsQualityFloors = (r) => {
  const rating = getRestaurantRating(r);
  if (rating != null && rating < MIN_RATING) return false;
  const eta = getRestaurantEtaMin(r);
  if (eta != null && eta > MAX_ETA_MIN) return false;
  // Unknown distance passes (search almost always populates it; the score
  // handles the rest) - only a KNOWN over-radius restaurant is excluded.
  const dist = getRestaurantDistanceKm(r);
  if (dist != null && dist > MAX_DELIVERY_KM) return false;
  return true;
};

/**
 * Brand key for chain dedupe: "Umar Biriyani - Greams road" and
 * "Umar Biriyani - T Nagar" are the same brand; one email must not show a
 * brand twice across cards + rows (different ids don't catch this).
 */
const brandKey = (r) => getRestaurantName(r).toLowerCase().split(' - ')[0].trim();

/**
 * All eligible candidates for a bucket, best first, rotation-aware: everything
 * NOT shown in the last send ranks ahead of last send's picks (which stay as
 * fallback rather than leaving the slot empty). Returning the full ranked list
 * (not just the winner) lets the selection walk down it when a winner's image
 * turns out to be dead.
 */
function rankBucketCandidates(candidates, bucket, usedIds = new Set(), excludeIds = new Set(), usedBrands = new Set()) {
  const eligible = (candidates || []).filter((r) => {
    const id = getRestaurantId(r);
    return id
      && !usedIds.has(id)
      && !usedBrands.has(brandKey(r))
      && getRestaurantImageId(r)
      && isOpenNow(r)
      && isDinnerWorthy(r)
      && meetsQualityFloors(r)
      && isRelevantForBucket(r, bucket);
  });

  const ranked = eligible
    .map((r) => ({ r, score: scoreRestaurant(r, bucket) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.r);

  const fresh = ranked.filter((r) => !excludeIds.has(getRestaurantId(r)));
  const shownLastTime = ranked.filter((r) => excludeIds.has(getRestaurantId(r)));
  return [...fresh, ...shownLastTime];
}

/** Back-compat single-winner API (tests + simple callers). */
function pickBestForBucket(candidates, bucket, usedIds = new Set(), excludeIds = new Set()) {
  return rankBucketCandidates(candidates, bucket, usedIds, excludeIds)[0] || null;
}

// ── Image liveness ───────────────────────────────────────────────────────────
// A valid-LOOKING cloudinaryImageId can point at a dead file on Swiggy's CDN -
// seen live: a card rendered as broken alt-text in the preview. Verify the
// image actually answers before a restaurant earns a card; on failure the
// selection walks down the ranked list. Results are cached (module-lifetime,
// capped) so preview + send don't re-check the same URLs.
const imageCheckCache = new Map(); // url -> boolean
const IMAGE_CACHE_MAX = 500;
const IMAGE_TRY_LIMIT = 4; // candidates to try per bucket before giving up

async function verifyImageUrl(url) {
  if (!url) return false;
  if (imageCheckCache.has(url)) return imageCheckCache.get(url);
  let ok;
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (res.status === 405) {
      // CDN refuses HEAD - fall back to a 1-byte ranged GET
      const g = await fetch(url, { headers: { Range: 'bytes=0-0' } });
      ok = g.ok;
    } else {
      ok = res.ok;
    }
  } catch (err) {
    // Network blip on OUR side, not evidence the image is dead - fail open so a
    // transient outage can't blank every card, but log it.
    console.warn('[TravelerDinner] image check errored (fail-open):', err.message);
    ok = true;
  }
  imageCheckCache.set(url, ok);
  if (imageCheckCache.size > IMAGE_CACHE_MAX) imageCheckCache.delete(imageCheckCache.keys().next().value);
  return ok;
}

/**
 * Card shape. The label is the restaurant's OWN primary cuisine (never an
 * imposed craving) and the link goes straight to that restaurant's menu.
 */
function toDinnerCard(restaurant, bucket, { lat, lng, origin, area }) {
  const id = getRestaurantId(restaurant);
  const rating = getRestaurantRating(restaurant);
  const cuisine = getPrimaryCuisine(restaurant) || bucket.label;
  return {
    id,
    name: getRestaurantName(restaurant),
    bucketKey: bucket.key,
    cuisineLabel: cuisine,
    rating,
    ratingLabel: rating != null ? `${rating.toFixed(1)} ★` : null,
    etaLabel: getRestaurantSlaLabel(restaurant),
    imageUrl: buildSwiggyCardImageUrl(getRestaurantImageId(restaurant)),
    linkLabel: 'Order now',
    orderUrl: buildRestaurantMenuUrl({ restaurantId: id, lat, lng, origin, area }),
  };
}

/** Text-only row for "Also delivering tonight". Links to that menu too. */
function toListingRow(restaurant, { lat, lng, origin, area }) {
  const id = getRestaurantId(restaurant);
  const cuisines = getRestaurantCuisines(restaurant).slice(0, 2);
  return {
    id,
    name: getRestaurantName(restaurant),
    cuisineLabel: cuisines.join(', '),
    orderUrl: buildRestaurantMenuUrl({ restaurantId: id, lat, lng, origin, area }),
  };
}

// ── Upstream search ──────────────────────────────────────────────────────────
function foodtoindiaBase() {
  return (process.env.FOODTOINDIA_BASE_URL || APP_ORIGIN).replace(/\/$/, '');
}

async function searchViaPublicApi({ lat, lng, searchText }) {
  const url = `${foodtoindiaBase()}/api/search?lat=${lat}&lng=${lng}&searchText=${encodeURIComponent(searchText)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`foodtoindia /api/search responded ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// Short-lived per-location cache. A location needs several upstream searches, so
// this makes re-opening a preview instant and lets travelers at the same hotel
// share one pull. Per warm instance only; resets on cold start.
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_CACHE_MAX = 100;
const searchCache = new Map(); // "lat,lng" -> { perBucket, ts }
const locationKey = (lat, lng) => `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;

/**
 * Build the full email selection for a location.
 *
 * @param {object} args
 * @param {number|string} args.lat
 * @param {number|string} args.lng
 * @param {string[]} [args.excludeIds=[]] - restaurant ids shown in the last send
 * @param {Array<{restaurantId:string,name:string,count:number}>} [args.pastFavorites=[]]
 *   The customer's repeat restaurants near this location. Only favorites that
 *   also appear in the live pool (so we KNOW they're open, real and current)
 *   become "Order again" rows - a favorite we can't verify is silently skipped.
 * @param {(q)=>Promise<object[]>} [args.search=searchViaPublicApi]
 * @param {(url)=>Promise<boolean>} [args.verifyImage] - injectable for tests
 * @param {boolean} [args.refresh=false]
 * @returns {Promise<{cards, alsoDelivering, reorderRows, shownIds}>}
 */
async function getTravelerDinnerSelection({
  lat,
  lng,
  excludeIds = [],
  pastFavorites = [],
  linkOrigin,
  area,
  buckets = DINNER_BUCKETS,
  search = searchViaPublicApi,
  verifyImage,
  refresh = false,
} = {}) {
  const useCache = search === searchViaPublicApi;
  // Injected search (tests) must never hit the network for image checks either.
  const checkImage = verifyImage || (useCache ? verifyImageUrl : async () => true);
  const key = locationKey(lat, lng);

  let pools;
  if (useCache && !refresh) {
    const hit = searchCache.get(key);
    if (hit && Date.now() - hit.ts < SEARCH_CACHE_TTL_MS) pools = hit.pools;
  }

  if (!pools) {
    // All searches fire at once - they're independent, and serial made a preview
    // take ~11s. One failing query must not sink the rest. The extra generic
    // "restaurant" query widens the pool for the text rows and gives past
    // favorites a real chance to be matched + verified.
    const runQuery = async (q) => {
      try {
        const results = await search({ lat, lng, searchText: q });
        return Array.isArray(results) ? results : [];
      } catch (err) {
        console.error(`[TravelerDinner] search failed for "${q}":`, err.message);
        return [];
      }
    };
    const [perBucket, genericPool] = await Promise.all([
      Promise.all(
        buckets.map((bucket) =>
          Promise.all(bucket.queries.map(runQuery)).then((lists) => lists.flat())
        )
      ),
      runQuery('restaurant'),
    ]);
    pools = { perBucket, genericPool };
    if (useCache && (perBucket.some((l) => l.length > 0) || genericPool.length > 0)) {
      searchCache.set(key, { pools, ts: Date.now() });
      if (searchCache.size > SEARCH_CACHE_MAX) searchCache.delete(searchCache.keys().next().value);
    }
  }

  const { perBucket, genericPool } = pools;
  const exclude = new Set((excludeIds || []).map(String));
  const usedIds = new Set();
  const usedBrands = new Set();
  const cards = [];

  // Cards: walk each bucket's ranked list until a candidate's image actually
  // answers - a dead CDN file must never reach a customer's inbox.
  for (let i = 0; i < buckets.length && cards.length < CARD_COUNT; i += 1) {
    const ranked = rankBucketCandidates(perBucket[i], buckets[i], usedIds, exclude, usedBrands);
    let winner = null;
    for (const cand of ranked.slice(0, IMAGE_TRY_LIMIT)) {
      const url = buildSwiggyCardImageUrl(getRestaurantImageId(cand));
      if (await checkImage(url)) { winner = cand; break; }
      console.warn(`[TravelerDinner] dead image, skipping card candidate: ${getRestaurantName(cand)}`);
    }
    if (winner) {
      usedIds.add(getRestaurantId(winner));
      usedBrands.add(brandKey(winner));
      cards.push(toDinnerCard(winner, buckets[i], { lat, lng, origin: linkOrigin, area }));
    }
  }

  // Index the full live pool by id for favorites matching.
  const poolIndex = new Map();
  for (const list of [...perBucket, genericPool]) {
    for (const r of list) {
      const id = getRestaurantId(r);
      if (id && !poolIndex.has(id)) poolIndex.set(id, r);
    }
  }

  // "Order again": the customer's own repeat restaurants, but only when the
  // live pool confirms them (open now, still listed). No rotation here - a
  // favorite staying visible every email is a feature.
  const reorderRows = [];
  for (const fav of pastFavorites) {
    if (reorderRows.length >= 2) break;
    const r = poolIndex.get(String(fav.restaurantId));
    if (!r) continue;
    const id = getRestaurantId(r);
    if (usedIds.has(id) || !isOpenNow(r)) continue;
    usedIds.add(id);
    usedBrands.add(brandKey(r));
    reorderRows.push({
      id,
      name: getRestaurantName(r),
      count: fav.count,
      orderUrl: buildRestaurantMenuUrl({ restaurantId: id, lat, lng, origin: linkOrigin, area }),
    });
  }

  // "A few more": everything we found, minus cards/favorites, best first, one
  // entry per brand, same quality floors as cards.
  const seen = new Set(usedIds);
  const seenBrands = new Set(usedBrands);
  const pool = [];
  for (const list of [...perBucket, genericPool]) {
    for (const r of list) {
      const id = getRestaurantId(r);
      if (!id || seen.has(id) || seenBrands.has(brandKey(r))) continue;
      if (!isOpenNow(r) || !isDinnerWorthy(r) || !meetsQualityFloors(r)) continue;
      seen.add(id);
      seenBrands.add(brandKey(r));
      pool.push(r);
    }
  }
  const rankedPool = pool
    .map((r) => ({ r, score: scoreForListing(r) }))
    .sort((a, b) => b.score - a.score);
  const freshFirst = [
    ...rankedPool.filter((x) => !exclude.has(getRestaurantId(x.r))),
    ...rankedPool.filter((x) => exclude.has(getRestaurantId(x.r))),
  ];
  const alsoDelivering = freshFirst.slice(0, ALSO_COUNT).map((x) => toListingRow(x.r, { lat, lng, origin: linkOrigin, area }));

  return {
    cards,
    alsoDelivering,
    reorderRows,
    shownIds: [...cards, ...alsoDelivering].map((x) => x.id).filter(Boolean),
  };
}

module.exports = {
  DINNER_BUCKETS,
  SEARCH_SOURCE,
  CARD_COUNT,
  ALSO_COUNT,
  getRestaurantId,
  getRestaurantName,
  getRestaurantRating,
  getRestaurantEtaMin,
  getRestaurantImageId,
  getRestaurantCuisines,
  getRestaurantSlaLabel,
  getRestaurantRatingCount,
  getPrimaryCuisine,
  parseRatingCount,
  isOpenNow,
  buildSwiggyCardImageUrl,
  buildRestaurantSearchUrl,
  buildRestaurantMenuUrl,
  isRelevantForBucket,
  isDinnerWorthy,
  meetsQualityFloors,
  brandKey,
  cuisineFocus,
  scoreRestaurant,
  scoreForListing,
  rankBucketCandidates,
  pickBestForBucket,
  verifyImageUrl,
  toDinnerCard,
  toListingRow,
  searchViaPublicApi,
  getTravelerDinnerSelection,
};
