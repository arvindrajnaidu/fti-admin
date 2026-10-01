import { db } from '../../lib/firebase';
import { isValidUser } from '../../lib/fraudUsers';
import { resolveCustomRange } from '../../lib/dateRange';
import { requireAuth } from '../../lib/withAuth';
// Use global cache to persist across hot reloads in development
if (!global.ordersCache) {
  global.ordersCache = null;
  global.ordersCacheTimestamp = null;
  global.ordersInFlight = null;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds
const FETCH_BATCH_SIZE = 50;

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

async function fetchAllOrdersFromFirestore() {
  console.log('[/api/orders] Fetching fresh orders from Firestore');
  const startedAt = Date.now();

  const usersSnapshot = await db.collection('users').get();
  const userDocs = usersSnapshot.docs;
  let skippedFraud = 0;

  const userOrdersArrays = [];
  for (let i = 0; i < userDocs.length; i += FETCH_BATCH_SIZE) {
    const batch = userDocs.slice(i, i + FETCH_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (userDoc) => {
        const userId = userDoc.id;
        const userData = userDoc.data();
        // Guest checkout intentionally stores identity under guestContact rather
        // than top-level email. Legacy users can also have orders beneath an
        // identity-less parent doc when the Auth onCreate profile writer missed.
        // Do not classify either case as fraud before reading their orders.
        const profileEmail = userData?.email || userData?.guestContact?.email || '';

        // A known profile email is authoritative for fraud filtering. When the
        // parent has no identity, defer the check until the order's senderEmail
        // is available below.
        if (profileEmail && !isValidUser(profileEmail)) {
          skippedFraud += 1;
          return [];
        }

        const senderName = deriveSenderName(userData);

        const ordersSnapshot = await db
          .collection('users')
          .doc(userId)
          .collection('orders')
          .get();

        return ordersSnapshot.docs.flatMap((orderDoc) => {
          const orderData = orderDoc.data();
          const senderEmail = orderData.senderEmail || profileEmail || '';

          // Legacy identity-less parents use the order snapshot as the fallback
          // identity. Keep truly unknown orders visible to ops; only an explicit
          // match to the fraud list should remove an order.
          if (!profileEmail && senderEmail && !isValidUser(senderEmail)) {
            skippedFraud += 1;
            return [];
          }

          let createdAtISO = null;
          if (orderData.createdAt) {
            if (typeof orderData.createdAt === 'number') {
              createdAtISO = new Date(orderData.createdAt).toISOString();
            } else if (orderData.createdAt.toDate) {
              createdAtISO = orderData.createdAt.toDate().toISOString();
            }
          }
          let updatedAtISO = null;
          if (orderData.updatedAt) {
            if (typeof orderData.updatedAt === 'number') {
              updatedAtISO = new Date(orderData.updatedAt).toISOString();
            } else if (orderData.updatedAt.toDate) {
              updatedAtISO = orderData.updatedAt.toDate().toISOString();
            }
          }
          // dispatchedAt is a Firestore serverTimestamp (set when tracking is
          // entered). Convert to ISO so the client's formatDate works and the
          // CSV export / order-detail page can show it. scheduling.* and
          // recipientContact.* are plain values and pass through via ...orderData.
          let dispatchedAtISO = null;
          if (orderData.dispatchedAt) {
            if (typeof orderData.dispatchedAt === 'number') {
              dispatchedAtISO = new Date(orderData.dispatchedAt).toISOString();
            } else if (orderData.dispatchedAt.toDate) {
              dispatchedAtISO = orderData.dispatchedAt.toDate().toISOString();
            }
          }

          return [{
            id: orderDoc.id,
            userId,
            ...orderData,
            senderEmail: senderEmail || 'Unknown',
            senderName: orderData.senderName || senderName || senderEmail || 'Unknown',
            createdAt: createdAtISO,
            updatedAt: updatedAtISO,
            dispatchedAt: dispatchedAtISO,
          }];
        });
      }),
    );
    userOrdersArrays.push(...batchResults);
  }

  const flat = userOrdersArrays.flat().sort((a, b) => {
    const dateA = new Date(a.createdAt || 0);
    const dateB = new Date(b.createdAt || 0);
    return dateB - dateA;
  });

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[/api/orders] Cached ${flat.length} orders from ${userDocs.length} users (skipped ${skippedFraud} fraud) in ${elapsedSec}s`,
  );
  return flat;
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
    const isCacheValid =
      global.ordersCache &&
      global.ordersCacheTimestamp &&
      now - global.ordersCacheTimestamp < CACHE_TTL;

    let ordersWithUserData;

    if (isCacheValid && forceRefresh !== 'true') {
      ordersWithUserData = global.ordersCache;
    } else if (global.ordersInFlight && forceRefresh !== 'true') {
      // Single-flight: another request is already doing the fetch. Wait for it
      // instead of starting a redundant scan.
      ordersWithUserData = await global.ordersInFlight;
    } else {
      const fetchPromise = fetchAllOrdersFromFirestore()
        .then((orders) => {
          global.ordersCache = orders;
          global.ordersCacheTimestamp = Date.now();
          return orders;
        })
        .finally(() => {
          global.ordersInFlight = null;
        });
      global.ordersInFlight = fetchPromise;
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
      cacheAge: global.ordersCacheTimestamp ? Math.floor((now - global.ordersCacheTimestamp) / 1000) : null, // seconds
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
