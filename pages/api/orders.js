import { db } from '../../lib/firebase';
import { isValidUser } from '../../lib/fraudUsers';
import { resolveCustomRange } from '../../lib/dateRange';
import { requireAuth } from '../../lib/withAuth';
// Use global cache to persist across hot reloads in development
// Keyed by fetch window: a 3-day read must not be served to a request asking
// for 30 days. Entries are small (306 orders = 30 days on production).
if (!global.ordersCacheByWindow) {
  global.ordersCacheByWindow = new Map(); // sinceMs|'all' -> { orders, at }
  global.ordersInFlightByWindow = new Map();
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

// How far back we read by default. Ops works the recent queue; the old
// behaviour read every order ever placed on every page load.
const DEFAULT_WINDOW_DAYS = 3;

// Ceiling on how far back a request may widen the window. 'all' is still
// honoured, but it is now an explicit, deliberate choice rather than the
// default that happened to everyone.
const MAX_WINDOW_DAYS = 365;

// Firestore caps `in` queries at 30 values; sender docs are fetched in chunks
// of this size via getAll.
const USER_FETCH_CHUNK = 30;

// Derive a senderName from the Firestore user doc only — no Auth round trip.
// Auth lookups dominate cold-fetch time (~100-300ms each, often failing for
// anonymous/deleted users) and the result is almost always already in the
// Firestore doc anyway. Falls back to the email's local part so search still
// works on something human-readable.
function deriveSenderName(userData) {
  if (!userData) return '';
  if (userData.displayName) return userData.displayName;
  if (userData.name) return userData.name;
  if (userData.guestContact?.name) return userData.guestContact.name;
  if (userData.email) return userData.email.split('@')[0];
  if (userData.guestContact?.email) return userData.guestContact.email.split('@')[0];
  return '';
}

// Read recent orders with ONE collection-group query.
//
// This replaced a scan that fetched every user document and then every order
// subcollection, one query per user. On production that was 2,061 queries and
// 6,451 document reads per refresh, to surface a list ops reads the top of —
// and roughly two thirds of those queries returned nothing, because most users
// have never ordered.
//
// Orders live at users/{uid}/orders/{orderId}, so they cannot be listed
// centrally with an ordinary query. A collection group query can, and the
// single-field index Firestore maintains on createdAt already serves it.
//
// NOTE: createdAt on these documents is epoch milliseconds stored as a NUMBER,
// not a Firestore Timestamp. Comparing it against a Timestamp matches nothing —
// Firestore orders values by type first — so the cutoff must be a number.
//
// Orders with no createdAt at all (5 of 4,391 in production, all legacy) are
// not reachable by a range query. They were previously visible; they are not
// now. That is the one behavioural loss, and it is why `days=all` still exists.
async function fetchRecentOrdersFromFirestore(sinceMs) {
  const startedAt = Date.now();

  let query = db.collectionGroup('orders');
  if (sinceMs != null) {
    query = query.where('createdAt', '>=', sinceMs);
  }
  const snapshot = await query.orderBy('createdAt', 'desc').get();

  // Sender identity lives on the parent user doc. Fetch only the senders who
  // actually appear in this window, deduplicated — not all 2,060 users.
  const userIds = [...new Set(snapshot.docs.map((d) => d.ref.parent.parent?.id).filter(Boolean))];
  const userDataById = new Map();
  for (let i = 0; i < userIds.length; i += USER_FETCH_CHUNK) {
    const refs = userIds.slice(i, i + USER_FETCH_CHUNK).map((id) => db.collection('users').doc(id));
    const docs = await db.getAll(...refs);
    for (const d of docs) if (d.exists) userDataById.set(d.id, d.data());
  }

  let skippedFraud = 0;
  const orders = [];

  for (const orderDoc of snapshot.docs) {
    const userId = orderDoc.ref.parent.parent?.id;
    if (!userId) continue;
    const orderData = orderDoc.data();
    const userData = userDataById.get(userId);

    // Guest checkout stores identity under guestContact rather than top-level
    // email. Legacy users can also have orders beneath an identity-less parent
    // doc when the Auth onCreate profile writer missed. Neither is fraud.
    const profileEmail = userData?.email || userData?.guestContact?.email || '';
    if (profileEmail && !isValidUser(profileEmail)) {
      skippedFraud += 1;
      continue;
    }

    const senderEmail = orderData.senderEmail || profileEmail || '';
    // Identity-less parents fall back to the order snapshot. Keep truly unknown
    // orders visible to ops; only an explicit fraud match removes one.
    if (!profileEmail && senderEmail && !isValidUser(senderEmail)) {
      skippedFraud += 1;
      continue;
    }

    orders.push({
      id: orderDoc.id,
      userId,
      ...orderData,
      senderEmail: senderEmail || 'Unknown',
      senderName: orderData.senderName || deriveSenderName(userData) || senderEmail || 'Unknown',
      createdAt: toISO(orderData.createdAt),
      updatedAt: toISO(orderData.updatedAt),
      dispatchedAt: toISO(orderData.dispatchedAt),
    });
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[/api/orders] ${orders.length} orders from 1 collection-group query ` +
      `+ ${Math.ceil(userIds.length / USER_FETCH_CHUNK)} sender batches ` +
      `(${userIds.length} senders, skipped ${skippedFraud} fraud) in ${elapsedSec}s`,
  );
  return orders;
}

// createdAt/updatedAt are epoch-ms numbers on most docs and Firestore
// Timestamps on a few (dispatchedAt is a serverTimestamp). Handle both.
function toISO(value) {
  if (!value) return null;
  if (typeof value === 'number') return new Date(value).toISOString();
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  return null;
}

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!db) {
    return res.status(500).json({
      error: 'Firebase not initialized',
      message: 'Please set FIREBASE_PRIVATE_KEY in .env.local file',
    });
  }

  try {
    const { limit = 25, search = '', page = 1, forceRefresh = 'false', days, startDate, endDate, status } = req.query;
    const limitNum = parseInt(limit);
    const pageNum = parseInt(page);
    const offset = (pageNum - 1) * limitNum;

    // Resolve the custom range up front so a bad range fails before the
    // expensive Firestore scan rather than after it.
    let customRange = null;
    if (startDate && endDate) {
      customRange = resolveCustomRange(req.query);
      if (customRange.error) {
        return res.status(400).json({ error: customRange.error });
      }
    }

    const now = Date.now();

    // How far back to READ. Previously everything was read and then filtered in
    // memory; now the window is pushed down into the query. The request can
    // widen it, but the default is a few days rather than all of history.
    let sinceMs = now - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    if (days === 'all') {
      sinceMs = null;
    } else if (customRange) {
      // Read from the start of the range; the end is applied by the filter
      // below, which already handles it.
      sinceMs = customRange.startMs;
    } else if (days) {
      const d = Math.min(parseInt(days, 10) || DEFAULT_WINDOW_DAYS, MAX_WINDOW_DAYS);
      sinceMs = now - d * 24 * 60 * 60 * 1000;
    }

    // Bucket the key to the minute so ordinary refreshes share a cache entry
    // instead of each computing a fresh `now` and missing.
    const windowKey = sinceMs == null ? 'all' : String(Math.floor(sinceMs / 60000));

    const cached = global.ordersCacheByWindow.get(windowKey);
    const isCacheValid = Boolean(cached) && now - cached.at < CACHE_TTL;

    let ordersWithUserData;

    if (isCacheValid && forceRefresh !== 'true') {
      ordersWithUserData = cached.orders;
    } else if (global.ordersInFlightByWindow.get(windowKey) && forceRefresh !== 'true') {
      // Single-flight per window: another request is already reading this same
      // range. Wait for it rather than issuing a duplicate query.
      ordersWithUserData = await global.ordersInFlightByWindow.get(windowKey);
    } else {
      const fetchPromise = fetchRecentOrdersFromFirestore(sinceMs)
        .then((orders) => {
          global.ordersCacheByWindow.set(windowKey, { orders, at: Date.now() });
          return orders;
        })
        .finally(() => {
          global.ordersInFlightByWindow.delete(windowKey);
        });
      global.ordersInFlightByWindow.set(windowKey, fetchPromise);
      ordersWithUserData = await fetchPromise;
    }

    // Apply date filter if provided
    let filteredOrders = ordersWithUserData;
    if (days || customRange) {
      let dateFilterStartMs = null;
      let dateFilterEndMs = null;

      if (customRange) {
        // Custom range — boundaries resolved in the viewer's timezone when the
        // browser sent startMs/endMs, server-local otherwise. See lib/dateRange.
        dateFilterStartMs = customRange.startMs;
        dateFilterEndMs = customRange.endMs;
      } else if (days && days !== 'all') {
        // Rolling window: exactly N*24h back from now. Snapping to midnight
        // here would widen it by up to a day *and* make it the server's
        // midnight (UTC on Vercel) rather than the viewer's. A rolling offset
        // has no calendar boundary, so it has no timezone to get wrong.
        dateFilterStartMs = Date.now() - parseInt(days, 10) * 24 * 60 * 60 * 1000;
      }

      if (dateFilterStartMs != null) {
        filteredOrders = filteredOrders.filter(order => {
          if (!order.createdAt) return false;
          const orderMs = new Date(order.createdAt).getTime();
          if (Number.isNaN(orderMs)) return false;

          if (dateFilterEndMs != null) {
            // Custom range - check between start and end
            return orderMs >= dateFilterStartMs && orderMs <= dateFilterEndMs;
          }
          // Preset range - check if after start date
          return orderMs >= dateFilterStartMs;
        });
      }
    }

    // Apply search filter if provided
    let searchFilteredOrders = filteredOrders;
    if (search) {
      const searchLower = search.toLowerCase();
      searchFilteredOrders = filteredOrders.filter(order =>
        order.id?.toLowerCase().includes(searchLower) ||
        order.senderEmail?.toLowerCase().includes(searchLower) ||
        order.senderName?.toLowerCase().includes(searchLower) ||
        order.recipient?.name?.toLowerCase().includes(searchLower) ||
        order.restaurantName?.toLowerCase().includes(searchLower) ||
        order.paymentIntent?.id?.toLowerCase().includes(searchLower) ||
        order.paymentMethodId?.toLowerCase().includes(searchLower)
      );
    }

    // Apply status filter if provided
    let statusFilteredOrders = searchFilteredOrders;
    if (status && status !== 'all') {
      statusFilteredOrders = searchFilteredOrders.filter(order => {
        const orderStatus = order.status || 'pending';
        return orderStatus === status;
      });
    }

    // Apply pagination with slice
    const totalOrders = statusFilteredOrders.length;
    const paginatedOrders = statusFilteredOrders.slice(offset, offset + limitNum);
    const totalPages = Math.ceil(totalOrders / limitNum);

    return res.status(200).json({
      orders: paginatedOrders,
      total: totalOrders,
      page: pageNum,
      limit: limitNum,
      totalPages: totalPages,
      cached: isCacheValid,
      cacheAge: cached ? Math.floor((now - cached.at) / 1000) : null, // seconds
      windowDays: sinceMs == null ? 'all' : Math.round((now - sinceMs) / 86400000),
    });

  } catch (error) {
    console.error('Error fetching orders:', error);

    // Check if this is the missing index error
    if (error.code === 9 || error.message?.includes('FAILED_PRECONDITION')) {
      return res.status(500).json({
        error: 'Firestore index required',
        message: 'Please create a composite index in Firebase Console:\n' +
                 '1. Go to Firebase Console > Firestore Database > Indexes\n' +
                 '2. Create a composite index with:\n' +
                 '   - Collection Group: orders\n' +
                 '   - Field: createdAt (Descending)\n' +
                 '   - Query scope: Collection group\n' +
                 'Or click the link in the error details to auto-create the index.',
        details: error.message
      });
    }

    return res.status(500).json({
      error: 'Failed to fetch orders',
      message: error.message
    });
  }
}
