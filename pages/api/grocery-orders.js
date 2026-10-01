import { db } from '../../lib/firebase';
import { isValidUser } from '../../lib/fraudUsers';
import { resolveCustomRange } from '../../lib/dateRange';
import { requireAuth } from '../../lib/withAuth';

// Separate cache from /api/orders. Grocery lives in users/{uid}/grocery_orders
// (not users/{uid}/orders), so the two are fully independent — and so are
// their caches. Keeping a distinct global means the six existing mutators
// that do `global.ordersCache = null` need no changes. See
// docs/grocery-admin-plan.html §6 for the rationale.
if (!global.groceryOrdersCache) {
  global.groceryOrdersCache = null;
  global.groceryOrdersCacheTimestamp = null;
  global.groceryOrdersInFlight = null;
}

const CACHE_TTL = 5 * 60 * 1000;
const FETCH_BATCH_SIZE = 50;

function deriveSenderName(userData) {
  if (!userData) return '';
  if (userData.displayName) return userData.displayName;
  if (userData.name) return userData.name;
  if (userData.email) return userData.email.split('@')[0];
  return '';
}

async function fetchAllGroceryOrdersFromFirestore() {
  console.log('[/api/grocery-orders] Fetching fresh grocery orders from Firestore');
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
        const senderEmail = userData?.email || '';

        if (!isValidUser(senderEmail)) {
          skippedFraud += 1;
          return [];
        }

        const senderName = deriveSenderName(userData);

        const ordersSnapshot = await db
          .collection('users')
          .doc(userId)
          .collection('grocery_orders')
          .get();

        return ordersSnapshot.docs.map((orderDoc) => {
          const orderData = orderDoc.data();

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

          return {
            id: orderDoc.id,
            userId,
            senderEmail: senderEmail || senderName || 'Unknown',
            senderName: senderName || senderEmail || 'Unknown',
            ...orderData,
            createdAt: createdAtISO,
            updatedAt: updatedAtISO,
          };
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
    `[/api/grocery-orders] Cached ${flat.length} grocery orders from ${userDocs.length} users (skipped ${skippedFraud} fraud) in ${elapsedSec}s`,
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
    const {
      limit = 25,
      search = '',
      page = 1,
      forceRefresh = 'false',
      days,
      startDate,
      endDate,
      status,
      source,
    } = req.query;
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
      global.groceryOrdersCache &&
      global.groceryOrdersCacheTimestamp &&
      now - global.groceryOrdersCacheTimestamp < CACHE_TTL;

    let allOrders;

    if (isCacheValid && forceRefresh !== 'true') {
      allOrders = global.groceryOrdersCache;
    } else if (global.groceryOrdersInFlight && forceRefresh !== 'true') {
      allOrders = await global.groceryOrdersInFlight;
    } else {
      const fetchPromise = fetchAllGroceryOrdersFromFirestore()
        .then((orders) => {
          global.groceryOrdersCache = orders;
          global.groceryOrdersCacheTimestamp = Date.now();
          return orders;
        })
        .finally(() => {
          global.groceryOrdersInFlight = null;
        });
      global.groceryOrdersInFlight = fetchPromise;
      allOrders = await fetchPromise;
    }

    // Date filter — same shape as /api/orders.
    let filteredOrders = allOrders;
    if (days || customRange) {
      let dateFilterStartMs = null;
      let dateFilterEndMs = null;

      if (customRange) {
        // Viewer-timezone boundaries when the browser sent startMs/endMs,
        // server-local otherwise. See lib/dateRange.
        dateFilterStartMs = customRange.startMs;
        dateFilterEndMs = customRange.endMs;
      } else if (days && days !== 'all') {
        // Rolling window: exactly N*24h back from now, with no calendar
        // boundary and so no timezone to get wrong. See lib/dateRange.
        dateFilterStartMs = Date.now() - parseInt(days, 10) * 24 * 60 * 60 * 1000;
      }

      if (dateFilterStartMs != null) {
        filteredOrders = filteredOrders.filter((order) => {
          if (!order.createdAt) return false;
          const orderMs = new Date(order.createdAt).getTime();
          if (Number.isNaN(orderMs)) return false;
          if (dateFilterEndMs != null) {
            return orderMs >= dateFilterStartMs && orderMs <= dateFilterEndMs;
          }
          return orderMs >= dateFilterStartMs;
        });
      }
    }

    // Search — grocery-specific fields (no restaurantName; store + source instead).
    let searchFilteredOrders = filteredOrders;
    if (search) {
      const searchLower = search.toLowerCase();
      searchFilteredOrders = filteredOrders.filter(
        (order) =>
          order.id?.toLowerCase().includes(searchLower) ||
          order.senderEmail?.toLowerCase().includes(searchLower) ||
          order.senderName?.toLowerCase().includes(searchLower) ||
          order.recipient?.name?.toLowerCase().includes(searchLower) ||
          order.source?.toLowerCase().includes(searchLower) ||
          order.store?.name?.toLowerCase().includes(searchLower) ||
          order.store?.area?.toLowerCase().includes(searchLower) ||
          order.store?.id?.toString().toLowerCase().includes(searchLower) ||
          order.paymentIntent?.id?.toLowerCase().includes(searchLower),
      );
    }

    let statusFilteredOrders = searchFilteredOrders;
    if (status && status !== 'all') {
      statusFilteredOrders = searchFilteredOrders.filter(
        (order) => (order.status || 'created') === status,
      );
    }

    // Source filter — instamart vs blinkit. Useful for ops debugging.
    let sourceFilteredOrders = statusFilteredOrders;
    if (source && source !== 'all') {
      sourceFilteredOrders = statusFilteredOrders.filter(
        (order) => order.source === source,
      );
    }

    const totalOrders = sourceFilteredOrders.length;
    const paginatedOrders = sourceFilteredOrders.slice(offset, offset + limitNum);
    const totalPages = Math.ceil(totalOrders / limitNum);

    return res.status(200).json({
      orders: paginatedOrders,
      total: totalOrders,
      page: pageNum,
      limit: limitNum,
      totalPages,
      cached: isCacheValid,
      cacheAge: global.groceryOrdersCacheTimestamp
        ? Math.floor((now - global.groceryOrdersCacheTimestamp) / 1000)
        : null,
    });
  } catch (error) {
    console.error('Error fetching grocery orders:', error);

    if (error.code === 9 || error.message?.includes('FAILED_PRECONDITION')) {
      return res.status(500).json({
        error: 'Firestore index required',
        message:
          'A composite index may be required. Subcollection: grocery_orders, field: createdAt (Descending).',
        details: error.message,
      });
    }

    return res.status(500).json({
      error: 'Failed to fetch grocery orders',
      message: error.message,
    });
  }
}
