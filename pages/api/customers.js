import { db, admin } from '../../lib/firebase';
import { isValidUser } from '../../lib/fraudUsers';
import { orderUsd } from '../../lib/currency';
import { requireAuth } from '../../lib/withAuth';

// VIP threshold. Replaces a bare `500000` paise test, which was ~$61 at Rs 82
// and ~$67 at Rs 75; totalSpent is now USD so the threshold is USD too.
const VIP_MIN_TOTAL_USD = 65;
// Use global cache to persist across hot reloads in development
if (!global.customersCache) {
  global.customersCache = null;
  global.customersCacheTimestamp = null;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Convert Firestore Timestamp values inside engagementHistory to ISO strings
// so the response is JSON-safe and the client can compare dates directly.
function serializeEngagementHistory(history) {
  if (!history || typeof history !== 'object') return {};
  const out = {};
  for (const [campaignType, entry] of Object.entries(history)) {
    if (!entry || typeof entry !== 'object') continue;
    const sentAt = entry.sentAt;
    let iso = null;
    if (sentAt) {
      if (typeof sentAt.toDate === 'function') iso = sentAt.toDate().toISOString();
      else if (typeof sentAt === 'string') iso = sentAt;
      else if (typeof sentAt === 'number') iso = new Date(sentAt).toISOString();
      else if (sentAt._seconds) iso = new Date(sentAt._seconds * 1000).toISOString();
    }
    out[campaignType] = {
      sentAt: iso,
      sentBy: entry.sentBy || null,
      subject: entry.subject || null,
    };
  }
  return out;
}

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!db) {
      return res.status(500).json({
        error: 'Firebase not initialized',
        message: 'Please check your Firebase configuration in .env.local'
      });
    }

    // Get query parameters
    const { segment, search, forceRefresh, showUnsubscribedOnly } = req.query;

    // Check cache validity
    const now = Date.now();
    const isCacheValid = global.customersCache && global.customersCacheTimestamp && (now - global.customersCacheTimestamp < CACHE_TTL);

    let customersData;

    if (isCacheValid && forceRefresh !== 'true') {
      console.log('Using cached customer data');
      customersData = global.customersCache;
    } else {
      console.log('Fetching fresh customer data from Firestore...');

      // Fetch all users first
      const usersSnapshot = await db.collection('users').get();
      console.log(`Found ${usersSnapshot.docs.length} users`);

      // Aggregate customer data
      const customerMap = new Map();
      const abandonedMap = new Map();

      // Fetch orders for each user in parallel batches
      const batchSize = 50;
      const userDocs = usersSnapshot.docs;

      for (let i = 0; i < userDocs.length; i += batchSize) {
        const batch = userDocs.slice(i, i + batchSize);

        await Promise.all(batch.map(async (userDoc) => {
          const userId = userDoc.id;
          const userData = userDoc.data();
          const senderEmail = (userData?.email || '').toLowerCase().trim();

          if (!senderEmail) return;

          // Skip fraud users
          if (!isValidUser(senderEmail)) return;

          // Check email preferences
          const emailUnsubscribed = userData?.emailPreferences?.unsubscribed || false;
          const unsubscribedAt = userData?.emailPreferences?.unsubscribedAt || null;

          // Surface engagement history so the customers UI can render cooldown state
          // without an extra fetch. See pages/api/customers/send-engagement.js for shape.
          const engagementHistory = serializeEngagementHistory(userData?.engagementHistory);

          // Get user's auth profile for display name and creation time
          let senderName = '';
          let createdAt = null;
          try {
            const userAuth = await admin.auth().getUser(userId);
            senderName = userAuth.displayName || userAuth.email || '';
            createdAt = userAuth.metadata.creationTime;
          } catch (error) {
            console.log(`Auth lookup failed for user ${userId}:`, error.message);
          }

          // Fetch orders for this user
          const ordersSnapshot = await db
            .collection('users')
            .doc(userId)
            .collection('orders')
            .get();

          // Check if user abandoned (no orders)
          if (ordersSnapshot.empty) {
            // Check if user has recipients
            const recipientsSnapshot = await db
              .collection('users')
              .doc(userId)
              .collection('recipients')
              .get();

            const hasRecipients = !recipientsSnapshot.empty;
            const recipientCount = recipientsSnapshot.size;

            // Track as abandoned account
            abandonedMap.set(senderEmail, {
              email: senderEmail,
              name: senderName || 'N/A',
              accountCreatedAt: createdAt,
              orderCount: 0,
              isAbandoned: true,
              hasRecipients,
              recipientCount,
              userId, // Add userId for potential actions
              emailUnsubscribed,
              unsubscribedAt,
              engagementHistory,
              attribution: userData?.attribution || null,
            });
            return;
          }

          // Initialize customer if not exists
          if (!customerMap.has(senderEmail)) {
            customerMap.set(senderEmail, {
              email: senderEmail,
              name: senderName || 'N/A',
              orders: [],
              totalSpent: 0,
              firstOrderDate: null,
              lastOrderDate: null,
              emailUnsubscribed,
              unsubscribedAt,
              engagementHistory,
              attribution: userData?.attribution || null,
            });
          }

          const customer = customerMap.get(senderEmail);

          // Process each order
          ordersSnapshot.docs.forEach(orderDoc => {
            const orderData = orderDoc.data();

            // Handle createdAt
            let createdAtISO = null;
            if (orderData.createdAt) {
              if (typeof orderData.createdAt === 'number') {
                createdAtISO = new Date(orderData.createdAt).toISOString();
              } else if (orderData.createdAt.toDate) {
                createdAtISO = orderData.createdAt.toDate().toISOString();
              }
            }

            // Add order to customer's orders
            customer.orders.push({
              id: orderDoc.id,
              createdAt: createdAtISO,
              // USD, not paise. pages/customers.js formatCurrency is a USD
              // passthrough (its comment says so), and :842 renders this
              // straight into it - emitting paise here printed a Rs139,710
              // order as "$139710.00". Regression from 0839eec, which changed
              // formatCurrency from /10000 to a passthrough and missed this
              // producer. orderUsd prefers the real Stripe charge.
              totalAmount: orderUsd(orderData),
              status: orderData.status,
              restaurantName: orderData.restaurantName,
              recipient: orderData.recipient,
            });

            // Update total spent. Converted per order at that order's own rate
            // (Stripe's charge when present) - summing paise across a pricing
            // change and dividing once under-reports revenue and LTV.
            customer.totalSpent += orderUsd({ ...orderData, createdAt: createdAtISO });

            // Update first/last order dates
            if (createdAtISO) {
              const orderDate = new Date(createdAtISO);
              if (!customer.firstOrderDate || orderDate < new Date(customer.firstOrderDate)) {
                customer.firstOrderDate = createdAtISO;
              }
              if (!customer.lastOrderDate || orderDate > new Date(customer.lastOrderDate)) {
                customer.lastOrderDate = createdAtISO;
              }
            }

            // Update name if needed
            if (senderName && customer.name === 'N/A') {
              customer.name = senderName;
            }
          });
        }));

        console.log(`Processed ${Math.min(i + batchSize, userDocs.length)}/${userDocs.length} users`);
      }

      // Convert customers to array with metrics
      const customersWithOrders = Array.from(customerMap.values()).map(customer => {
        const daysSinceLastOrder = customer.lastOrderDate
          ? Math.floor((Date.now() - new Date(customer.lastOrderDate)) / (1000 * 60 * 60 * 24))
          : null;

        const avgOrderValue = customer.orders.length > 0
          ? customer.totalSpent / customer.orders.length
          : 0;

        return {
          ...customer,
          orderCount: customer.orders.length,
          daysSinceLastOrder,
          avgOrderValue,
          isAbandoned: false,
        };
      });

      // Convert abandoned accounts to array with metrics
      const abandonedAccounts = Array.from(abandonedMap.values()).map(account => {
        const daysSinceSignup = account.accountCreatedAt
          ? Math.floor((Date.now() - new Date(account.accountCreatedAt)) / (1000 * 60 * 60 * 24))
          : null;

        return {
          ...account,
          daysSinceSignup,
          totalSpent: 0,
          avgOrderValue: 0,
          daysSinceLastOrder: null,
          firstOrderDate: null,
          lastOrderDate: null,
          orders: [],
        };
      });

      // Combine both arrays
      customersData = {
        customers: customersWithOrders,
        abandoned: abandonedAccounts,
      };

      // Cache the results
      global.customersCache = customersData;
      global.customersCacheTimestamp = now;
      console.log(`Cached ${customersWithOrders.length} customers and ${abandonedAccounts.length} abandoned accounts`);
    }

    // Select appropriate dataset based on segment
    let customers;

    if (segment === 'abandoned') {
      // Show only abandoned accounts
      customers = customersData.abandoned;
    } else {
      // Show customers with orders (default)
      customers = customersData.customers;

      // Apply segment filter for customers
      if (segment && segment !== 'all') {
        const now = Date.now();
        const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
        const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);

        customers = customers.filter(customer => {
          const lastOrderDate = new Date(customer.lastOrderDate).getTime();

          switch (segment) {
            case 'vip':
              // High spend (>$50) AND frequent orders (3+)
              return customer.totalSpent >= VIP_MIN_TOTAL_USD && customer.orderCount >= 3;

            case 'at-risk':
              // Ordered before but not in last 30 days (and has at least 2 orders)
              return customer.orderCount >= 2 && lastOrderDate < thirtyDaysAgo;

            case 'one-time':
              // Only 1 order
              return customer.orderCount === 1;

            case 'active':
              // Ordered in last 30 days
              return lastOrderDate >= thirtyDaysAgo;

            case 'new':
              // First order in last 7 days
              const firstOrderDate = new Date(customer.firstOrderDate).getTime();
              return firstOrderDate >= sevenDaysAgo;

            case 'loyal':
              // 5+ orders
              return customer.orderCount >= 5;

            default:
              return true;
          }
        });
      }
    }

    // Apply search filter (works for both customers and abandoned)
    if (search) {
      const searchLower = search.toLowerCase();
      customers = customers.filter(customer =>
        customer.name.toLowerCase().includes(searchLower) ||
        customer.email.toLowerCase().includes(searchLower)
      );
    }

    // Apply unsubscribed filter
    if (showUnsubscribedOnly === 'true') {
      customers = customers.filter(customer => customer.emailUnsubscribed === true);
    }

    // Sort: abandoned by signup date, customers by total spent
    if (segment === 'abandoned') {
      // Sort abandoned accounts by signup date (most recent first)
      customers.sort((a, b) => {
        const dateA = new Date(a.accountCreatedAt || 0);
        const dateB = new Date(b.accountCreatedAt || 0);
        return dateB - dateA;
      });
    } else {
      // Sort customers by total spent (descending)
      customers.sort((a, b) => b.totalSpent - a.totalSpent);
    }

    console.log(`Returning ${customers.length} customers`);

    return res.status(200).json({
      customers,
      total: customers.length,
    });

  } catch (error) {
    console.error('Error fetching customers:', error);
    return res.status(500).json({
      error: 'Failed to fetch customers',
      message: error.message,
    });
  }
}
