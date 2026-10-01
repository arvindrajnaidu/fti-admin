import { db, admin } from '../../../lib/firebase';
import { isValidUser, getFraudUserCount } from '../../../lib/fraudUsers';
import {
  resolveCustomRange,
  rangeCacheSuffix,
  isCalendarPreset,
  resolvePresetRange,
  presetCacheSuffix,
} from '../../../lib/dateRange';
import { orderUsd } from '../../../lib/currency';
import { requireAuth } from '../../../lib/withAuth';
// Use global cache to persist across hot reloads
if (!global.analyticsCache) {
  global.analyticsCache = null;
  global.analyticsCacheTimestamp = null;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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

    const { days, startDate: startDateParam, endDate: endDateParam } = req.query;

    let endDate, startDate, previousStartDate, cacheKey;

    // Handle custom date range
    if (startDateParam && endDateParam) {
      // Boundaries come from the viewer's browser when it sends startMs/endMs,
      // so the picked days mean the same calendar days regardless of the
      // server's timezone (UTC on Vercel). See lib/dateRange.
      const range = resolveCustomRange(req.query);
      if (range.error) {
        return res.status(400).json({ error: range.error, message: range.error });
      }

      startDate = new Date(range.startMs);
      endDate = new Date(range.endMs);

      // Calculate previous period (same duration)
      const duration = endDate.getTime() - startDate.getTime();
      previousStartDate = new Date(startDate.getTime() - duration);

      // The epoch boundaries are part of the key: two viewers in different
      // timezones picking the same dates get different windows and must not
      // share a cache entry.
      cacheKey = `kpis_custom_${rangeCacheSuffix(range)}`;
      console.log(`Using custom date range: ${startDateParam} to ${endDateParam}`);
    } else if (isCalendarPreset(days)) {
      // MTD/QTD/YTD are calendar anchors, not rolling windows: "this month"
      // only has epoch boundaries once a timezone is chosen. The browser sends
      // the ones it resolved in the viewer's zone; server-local (UTC on Vercel)
      // is the fallback for direct curl/script callers. See lib/dateRange.
      const range = resolvePresetRange(days, req.query);
      if (range.error) {
        return res.status(400).json({ error: range.error, message: range.error });
      }

      startDate = new Date(range.startMs);
      endDate = new Date(range.endMs);
      previousStartDate = new Date(range.prevStartMs);

      // The boundaries are part of the key: two viewers in different timezones
      // asking for the same preset get different windows and must not share a
      // cache entry.
      cacheKey = `kpis_${presetCacheSuffix(range)}`;
      console.log(
        `Calculating ${range.preset.toUpperCase()} analytics ` +
          `(${range.viewerResolved ? 'viewer' : 'server'}-resolved)...`,
      );
    } else {
      // Handle days-based range (default)
      const daysNum = parseInt(days || 30);
      endDate = new Date();
      startDate = new Date(endDate.getTime() - daysNum * 24 * 60 * 60 * 1000);
      previousStartDate = new Date(startDate.getTime() - daysNum * 24 * 60 * 60 * 1000);
      cacheKey = `kpis_${daysNum}`;
      console.log(`Calculating fresh analytics for ${daysNum} days...`);
    }

    // Check cache validity
    const now = Date.now();
    const isCacheValid =
      global.analyticsCache?.[cacheKey] &&
      global.analyticsCacheTimestamp?.[cacheKey] &&
      (now - global.analyticsCacheTimestamp[cacheKey] < CACHE_TTL);

    if (isCacheValid) {
      console.log(`Using cached analytics data for cache key: ${cacheKey}`);
      return res.status(200).json(global.analyticsCache[cacheKey]);
    }

    const apiStartTime = Date.now();

    // Fetch all users
    const usersSnapshot = await db.collection('users').get();
    console.log(`Found ${usersSnapshot.docs.length} users (${Date.now() - apiStartTime}ms)`);
    console.log(`Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);

    // Aggregate all orders
    const allOrders = [];
    const customerOrders = new Map(); // Map of email -> orders[]
    const customerFirstOrder = new Map(); // Map of email -> first order date

    // Process users in parallel batches for faster loading
    const batchSize = 50;
    const userDocs = usersSnapshot.docs;

    for (let i = 0; i < userDocs.length; i += batchSize) {
      const batch = userDocs.slice(i, i + batchSize);

      const batchResults = await Promise.all(batch.map(async (userDoc) => {
        const userId = userDoc.id;
        const userData = userDoc.data();
        const email = userData?.email?.toLowerCase()?.trim() || '';

        if (!email) return [];

        // Skip fraud users
        if (!isValidUser(email)) {
          return [];
        }

        // Fetch orders
        const ordersSnapshot = await db
          .collection('users')
          .doc(userId)
          .collection('orders')
          .get();

        const userOrders = [];
        ordersSnapshot.docs.forEach(orderDoc => {
          const order = orderDoc.data();

          // Parse createdAt
          let createdAt = null;
          if (order.createdAt) {
            if (typeof order.createdAt === 'number') {
              createdAt = new Date(order.createdAt);
            } else if (order.createdAt.toDate) {
              createdAt = order.createdAt.toDate();
            }
          }

          if (!createdAt) return;

          userOrders.push({
            id: orderDoc.id,
            userId,
            email,
            senderName: userData.displayName || email.split('@')[0],
            createdAt,
            totalAmount: order.totalAmount || 0,
            // USD converted at THIS order's rate (Stripe's charge when present).
            // Summing paise across a pricing change and dividing once is wrong.
            usd: orderUsd({ ...order, createdAt }),
            status: order.status || 'pending',
            recipientCity: order.recipient?.location?.city || null,
            restaurantName: order.restaurantName || null,
            lineItems: order.lineItems || {}
          });
        });

        return userOrders;
      }));

      // Aggregate batch results
      batchResults.flat().forEach(orderData => {
        allOrders.push(orderData);

        const email = orderData.email;
        // Track customer orders
        if (!customerOrders.has(email)) {
          customerOrders.set(email, []);
        }
        customerOrders.get(email).push(orderData);

        // Track first order
        if (!customerFirstOrder.has(email) || orderData.createdAt < customerFirstOrder.get(email)) {
          customerFirstOrder.set(email, orderData.createdAt);
        }
      });

      // Log progress for large datasets
      if (userDocs.length > 100) {
        console.log(`Processed ${Math.min(i + batchSize, userDocs.length)}/${userDocs.length} users...`);
      }
    }

    console.log(`Total orders: ${allOrders.length} (${Date.now() - apiStartTime}ms)`);

    // Log the date range of all orders to help debug
    if (allOrders.length > 0) {
      const sortedByDate = [...allOrders].sort((a, b) => a.createdAt - b.createdAt);
      console.log(`Earliest order: ${sortedByDate[0].createdAt.toISOString()}`);
      console.log(`Latest order: ${sortedByDate[sortedByDate.length - 1].createdAt.toISOString()}`);
    }

    // Filter orders by time range
    const currentOrders = allOrders.filter(o => o.createdAt >= startDate && o.createdAt <= endDate);
    const previousOrders = allOrders.filter(o => o.createdAt >= previousStartDate && o.createdAt < startDate);

    // ============================================
    // CALCULATE KPIS
    // ============================================

    // Growth Metrics - New Customers
    // Customers whose FIRST order is in the current period
    const newCustomers = Array.from(customerFirstOrder.entries()).filter(([email, firstOrderDate]) => {
      return firstOrderDate >= startDate && firstOrderDate <= endDate;
    }).length;

    const previousNewCustomers = Array.from(customerFirstOrder.entries()).filter(([email, firstOrderDate]) => {
      return firstOrderDate >= previousStartDate && firstOrderDate < startDate;
    }).length;

    // Returning Customers - Customers who ordered in current period AND ordered before the period started
    const returningCustomers = Array.from(customerOrders.entries()).filter(([email, orders]) => {
      const hasOrderInCurrentPeriod = orders.some(o => o.createdAt >= startDate && o.createdAt <= endDate);
      const hasOrderBeforePeriod = orders.some(o => o.createdAt < startDate);
      return hasOrderInCurrentPeriod && hasOrderBeforePeriod;
    }).length;

    const previousReturningCustomers = Array.from(customerOrders.entries()).filter(([email, orders]) => {
      const hasOrderInPreviousPeriod = orders.some(o => o.createdAt >= previousStartDate && o.createdAt < startDate);
      const hasOrderBeforePrevious = orders.some(o => o.createdAt < previousStartDate);
      return hasOrderInPreviousPeriod && hasOrderBeforePrevious;
    }).length;

    // Customer Metrics (calculated first as they're used by other metrics)
    const uniqueCustomers = new Set(allOrders.map(o => o.email)).size;
    const activeCustomers = new Set(currentOrders.map(o => o.email)).size;
    const previousActiveCustomers = new Set(previousOrders.map(o => o.email)).size;

    // Revenue Metrics
    const totalRevenue = currentOrders.reduce((sum, o) => sum + o.usd, 0);
    const previousRevenue = previousOrders.reduce((sum, o) => sum + o.usd, 0);
    const avgOrderValue = currentOrders.length > 0 ? totalRevenue / currentOrders.length : 0;
    const previousAOV = previousOrders.length > 0 ? previousRevenue / previousOrders.length : 0;
    const revenuePerActiveCustomer = activeCustomers > 0 ? totalRevenue / activeCustomers : 0;
    const previousRevenuePerActive = previousActiveCustomers > 0 ? previousRevenue / previousActiveCustomers : 0;

    console.log(`Revenue Calculation: ${currentOrders.length} orders, Total: $${totalRevenue.toFixed(2)} USD`);

    // Calculate LTV (average total spent per customer) - ALL TIME
    const customerLifetimeValues = Array.from(customerOrders.entries()).map(([email, orders]) => {
      const totalSpent = orders.reduce((sum, o) => sum + o.usd, 0);
      return totalSpent;
    });
    const avgLTV = customerLifetimeValues.length > 0
      ? customerLifetimeValues.reduce((sum, ltv) => sum + ltv, 0) / customerLifetimeValues.length
      : 0;

    // Previous LTV (only from customers who existed in previous period)
    const previousCustomersLTV = Array.from(customerOrders.entries())
      .filter(([email, orders]) => {
        const firstOrder = Math.min(...orders.map(o => o.createdAt.getTime()));
        return firstOrder < startDate.getTime();
      })
      .map(([email, orders]) => {
        const totalSpent = orders
          .filter(o => o.createdAt < startDate)
          .reduce((sum, o) => sum + o.usd, 0);
        return totalSpent;
      });
    const previousLTV = previousCustomersLTV.length > 0
      ? previousCustomersLTV.reduce((sum, ltv) => sum + ltv, 0) / previousCustomersLTV.length
      : 0;

    // Repeat purchase rate - SCOPED TO PERIOD
    // Of customers active in the current period, how many are repeat customers (ever)?
    const activeCustomerEmails = new Set(currentOrders.map(o => o.email));
    const repeatCustomersInPeriod = Array.from(activeCustomerEmails).filter(email => {
      const orders = customerOrders.get(email) || [];
      return orders.length > 1;
    }).length;
    const repeatRate = activeCustomers > 0 ? (repeatCustomersInPeriod / activeCustomers) * 100 : 0;

    // Previous repeat rate
    const previousActiveCustomerEmails = new Set(previousOrders.map(o => o.email));
    const previousRepeatCustomers = Array.from(previousActiveCustomerEmails).filter(email => {
      const orders = customerOrders.get(email) || [];
      const ordersBeforeCurrent = orders.filter(o => o.createdAt < startDate);
      return ordersBeforeCurrent.length > 1;
    }).length;
    const previousRepeatRate = previousActiveCustomers > 0
      ? (previousRepeatCustomers / previousActiveCustomers) * 100
      : 0;

    // Average orders per customer - SCOPED TO PERIOD
    const avgOrdersPerCustomer = activeCustomers > 0 ? currentOrders.length / activeCustomers : 0;
    const previousAvgOrders = previousActiveCustomers > 0
      ? previousOrders.length / previousActiveCustomers
      : 0;

    // Days to 2nd order
    const secondOrderTimes = [];
    customerOrders.forEach((orders, email) => {
      if (orders.length >= 2) {
        const sorted = orders.sort((a, b) => a.createdAt - b.createdAt);
        const daysDiff = (sorted[1].createdAt - sorted[0].createdAt) / (1000 * 60 * 60 * 24);
        secondOrderTimes.push(daysDiff);
      }
    });
    const avgDaysTo2ndOrder = secondOrderTimes.length > 0
      ? secondOrderTimes.reduce((sum, days) => sum + days, 0) / secondOrderTimes.length
      : null;

    // Previous days to 2nd order (customers who got 2nd order before startDate)
    const previousSecondOrderTimes = [];
    customerOrders.forEach((orders, email) => {
      const ordersBeforeStart = orders.filter(o => o.createdAt < startDate);
      if (ordersBeforeStart.length >= 2) {
        const sorted = ordersBeforeStart.sort((a, b) => a.createdAt - b.createdAt);
        const daysDiff = (sorted[1].createdAt - sorted[0].createdAt) / (1000 * 60 * 60 * 24);
        previousSecondOrderTimes.push(daysDiff);
      }
    });
    const previousDaysTo2nd = previousSecondOrderTimes.length > 0
      ? previousSecondOrderTimes.reduce((sum, days) => sum + days, 0) / previousSecondOrderTimes.length
      : null;

    // Churn rate (customers who haven't ordered in 60+ days)
    // Formula: Customers with last order > 60 days ago / Total customers
    const sixtyDaysAgo = new Date(endDate.getTime() - 60 * 24 * 60 * 60 * 1000);

    const churnedCustomers = Array.from(customerOrders.entries()).filter(([email, orders]) => {
      const lastOrder = Math.max(...orders.map(o => o.createdAt.getTime()));
      return new Date(lastOrder) < sixtyDaysAgo;
    }).length;

    const churnRate = uniqueCustomers > 0
      ? (churnedCustomers / uniqueCustomers) * 100
      : 0;

    console.log(`Churn Calculation: ${churnedCustomers} churned / ${uniqueCustomers} total customers = ${churnRate.toFixed(1)}%`);

    // Previous churn rate (as of the start of current period)
    const previousSixtyDaysAgo = new Date(startDate.getTime() - 60 * 24 * 60 * 60 * 1000);

    // Total customers who had ordered before the current period
    const previousTotalCustomers = Array.from(customerOrders.entries()).filter(([email, orders]) => {
      return orders.some(o => o.createdAt < startDate);
    }).length;

    // Of those, how many had their last order > 60 days before the start of current period
    const previousChurned = Array.from(customerOrders.entries()).filter(([email, orders]) => {
      const ordersBeforeStart = orders.filter(o => o.createdAt < startDate);
      if (ordersBeforeStart.length === 0) return false;
      const lastOrder = Math.max(...ordersBeforeStart.map(o => o.createdAt.getTime()));
      return new Date(lastOrder) < previousSixtyDaysAgo;
    }).length;

    const previousChurnRate = previousTotalCustomers > 0
      ? (previousChurned / previousTotalCustomers) * 100
      : 0;

    // Reactivation Rate
    // Dormant customers (60+ days since last order before period start) who ordered in current period
    const dormantCustomersAtStart = Array.from(customerOrders.entries()).filter(([email, orders]) => {
      const ordersBeforeStart = orders.filter(o => o.createdAt < startDate);
      if (ordersBeforeStart.length === 0) return false;
      const lastOrderBeforeStart = Math.max(...ordersBeforeStart.map(o => o.createdAt.getTime()));
      const daysSinceLastOrder = (startDate.getTime() - lastOrderBeforeStart) / (1000 * 60 * 60 * 24);
      return daysSinceLastOrder >= 60;
    });

    const reactivatedCustomers = dormantCustomersAtStart.filter(([email, orders]) => {
      // Check if they ordered in current period
      return currentOrders.some(o => o.email === email);
    }).length;

    const reactivationRate = dormantCustomersAtStart.length > 0
      ? (reactivatedCustomers / dormantCustomersAtStart.length) * 100
      : 0;

    // Previous reactivation rate
    const previousDormantCustomersAtStart = Array.from(customerOrders.entries()).filter(([email, orders]) => {
      const ordersBeforePrevious = orders.filter(o => o.createdAt < previousStartDate);
      if (ordersBeforePrevious.length === 0) return false;
      const lastOrderBeforePrevious = Math.max(...ordersBeforePrevious.map(o => o.createdAt.getTime()));
      const daysSinceLastOrder = (previousStartDate.getTime() - lastOrderBeforePrevious) / (1000 * 60 * 60 * 24);
      return daysSinceLastOrder >= 60;
    });

    const previousReactivatedCustomers = previousDormantCustomersAtStart.filter(([email, orders]) => {
      return previousOrders.some(o => o.email === email);
    }).length;

    const previousReactivationRate = previousDormantCustomersAtStart.length > 0
      ? (previousReactivatedCustomers / previousDormantCustomersAtStart.length) * 100
      : 0;

    // Cohort Buckets (based on current time)
    // New: first order < 30 days ago
    // At Risk: last order 30-60 days ago
    // Dormant: last order 60-90 days ago
    // Churned: last order 90+ days ago
    const cohortBuckets = {
      new: 0,
      atRisk: 0,
      dormant: 0,
      churned: 0
    };

    Array.from(customerOrders.entries()).forEach(([email, orders]) => {
      const firstOrder = Math.min(...orders.map(o => o.createdAt.getTime()));
      const lastOrder = Math.max(...orders.map(o => o.createdAt.getTime()));
      const daysSinceFirst = (endDate.getTime() - firstOrder) / (1000 * 60 * 60 * 24);
      const daysSinceLast = (endDate.getTime() - lastOrder) / (1000 * 60 * 60 * 24);

      if (daysSinceFirst < 30) {
        cohortBuckets.new++;
      } else if (daysSinceLast >= 90) {
        cohortBuckets.churned++;
      } else if (daysSinceLast >= 60) {
        cohortBuckets.dormant++;
      } else if (daysSinceLast >= 30) {
        cohortBuckets.atRisk++;
      }
    });

    // Order Metrics
    const dispatchedOrders = currentOrders.filter(o => o.status === 'dispatched').length;
    const cancelledOrders = currentOrders.filter(o => o.status === 'cancelled').length;
    const completionRate = currentOrders.length > 0 ? (dispatchedOrders / currentOrders.length) * 100 : 0;
    const cancellationRate = currentOrders.length > 0 ? (cancelledOrders / currentOrders.length) * 100 : 0;

    // Previous order metrics
    const previousDispatched = previousOrders.filter(o => o.status === 'dispatched').length;
    const previousCancelled = previousOrders.filter(o => o.status === 'cancelled').length;
    const previousCompletionRate = previousOrders.length > 0
      ? (previousDispatched / previousOrders.length) * 100
      : 0;
    const previousCancellationRate = previousOrders.length > 0
      ? (previousCancelled / previousOrders.length) * 100
      : 0;

    // Average items per order
    const totalItems = currentOrders.reduce((sum, o) => {
      return sum + Object.keys(o.lineItems).length;
    }, 0);
    const avgItems = currentOrders.length > 0 ? totalItems / currentOrders.length : 0;

    const previousTotalItems = previousOrders.reduce((sum, o) => {
      return sum + Object.keys(o.lineItems).length;
    }, 0);
    const previousAvgItems = previousOrders.length > 0 ? previousTotalItems / previousOrders.length : 0;

    // Cohort Analysis (monthly cohorts)
    const cohorts = new Map();
    customerFirstOrder.forEach((firstOrderDate, email) => {
      const cohortMonth = `${firstOrderDate.getFullYear()}-${String(firstOrderDate.getMonth() + 1).padStart(2, '0')}`;

      if (!cohorts.has(cohortMonth)) {
        cohorts.set(cohortMonth, {
          month: cohortMonth,
          customers: new Set(),
          orders: 0,
          revenue: 0
        });
      }

      const cohort = cohorts.get(cohortMonth);
      cohort.customers.add(email);

      // Add all orders from this customer
      const custOrders = customerOrders.get(email) || [];
      cohort.orders += custOrders.length;
      cohort.revenue += custOrders.reduce((sum, o) => sum + o.usd, 0);
    });

    // ============================================
    // TIME SERIES (last 12 + prior 12 weeks; last 12 + prior 12 months)
    // ============================================
    // Anchored to endDate so trends respect the current date-range selection.
    // `weekly`  = weeks  -11..0 (most recent 12, oldest first)
    // `priorWeekly` = weeks -23..-12 (the 12 weeks before those, for overlay comparison)
    const buildWeekBucket = (weekEnd) => {
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekEnd.getDate() - 6);
      weekStart.setHours(0, 0, 0, 0);
      const weekOrders = allOrders.filter(
        (o) => o.createdAt >= weekStart && o.createdAt <= weekEnd,
      );
      return {
        label: weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        startISO: weekStart.toISOString(),
        endISO: weekEnd.toISOString(),
        orders: weekOrders.length,
        revenue: weekOrders.reduce((sum, o) => sum + o.usd, 0),
        dispatched: weekOrders.filter((o) => o.status === 'dispatched').length,
        cancelled: weekOrders.filter((o) => o.status === 'cancelled').length,
      };
    };
    const weeklySeries = [];
    const priorWeeklySeries = [];
    for (let i = 11; i >= 0; i--) {
      const weekEnd = new Date(endDate);
      weekEnd.setHours(23, 59, 59, 999);
      weekEnd.setDate(weekEnd.getDate() - i * 7);
      weeklySeries.push(buildWeekBucket(weekEnd));
    }
    for (let i = 23; i >= 12; i--) {
      const weekEnd = new Date(endDate);
      weekEnd.setHours(23, 59, 59, 999);
      weekEnd.setDate(weekEnd.getDate() - i * 7);
      priorWeeklySeries.push(buildWeekBucket(weekEnd));
    }

    const buildMonthBucket = (anchor) => {
      const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 0, 0, 0, 0);
      const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59, 999);
      const monthOrders = allOrders.filter(
        (o) => o.createdAt >= monthStart && o.createdAt <= monthEnd,
      );
      return {
        label: monthStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        startISO: monthStart.toISOString(),
        endISO: monthEnd.toISOString(),
        orders: monthOrders.length,
        revenue: monthOrders.reduce((sum, o) => sum + o.usd, 0),
        dispatched: monthOrders.filter((o) => o.status === 'dispatched').length,
        cancelled: monthOrders.filter((o) => o.status === 'cancelled').length,
      };
    };
    const monthlySeries = [];
    const priorMonthlySeries = [];
    for (let i = 11; i >= 0; i--) {
      monthlySeries.push(
        buildMonthBucket(new Date(endDate.getFullYear(), endDate.getMonth() - i, 1)),
      );
    }
    for (let i = 23; i >= 12; i--) {
      priorMonthlySeries.push(
        buildMonthBucket(new Date(endDate.getFullYear(), endDate.getMonth() - i, 1)),
      );
    }

    const cohortArray = Array.from(cohorts.values())
      .map(cohort => ({
        month: cohort.month,
        customers: cohort.customers.size,
        orders: cohort.orders,
        revenue: cohort.revenue,
        avgLTV: cohort.customers.size > 0 ? cohort.revenue / cohort.customers.size : 0,
        repeatRate: Array.from(cohort.customers).filter(email => {
          return (customerOrders.get(email) || []).length > 1;
        }).length / cohort.customers.size * 100
      }))
      .sort((a, b) => b.month.localeCompare(a.month));

    // Build response
    const kpis = {
      growth: {
        newCustomers,
        previousNewCustomers,
        returningCustomers,
        previousReturningCustomers,
        // Note: referralOrders would require tracking referral codes in order data
        // viralCoefficient would require tracking referrals per customer
      },
      revenue: {
        total: totalRevenue,
        previous: previousRevenue,
        avgOrderValue,
        previousAOV,
        revenuePerActiveCustomer,
        previousRevenuePerActive
      },
      customers: {
        total: uniqueCustomers,
        active: activeCustomers,
        previousActive: previousActiveCustomers,
        repeat: repeatCustomersInPeriod,
        repeatRate,
        previousRepeatRate,
        ltv: avgLTV,
        previousLTV,
        avgOrders: avgOrdersPerCustomer,
        previousAvgOrders,
        daysTo2ndOrder: avgDaysTo2ndOrder,
        previousDaysTo2nd,
        churned: churnedCustomers,
        churnRate,
        previousChurnRate,
        reactivated: reactivatedCustomers,
        reactivationRate,
        previousReactivationRate
      },
      cohortBuckets,
      orders: {
        total: currentOrders.length,
        previous: previousOrders.length,
        dispatched: dispatchedOrders,
        cancelled: cancelledOrders,
        completionRate,
        previousCompletionRate,
        cancellationRate,
        previousCancellationRate,
        avgItems,
        previousAvgItems
      },
      cohorts: cohortArray,
      timeseries: {
        weekly: weeklySeries,
        priorWeekly: priorWeeklySeries,
        monthly: monthlySeries,
        priorMonthly: priorMonthlySeries,
      },
      metadata: {
        fraudUsersExcluded: getFraudUserCount(),
        calculatedAt: new Date().toISOString()
      }
    };

    // Cache the results
    if (!global.analyticsCache) global.analyticsCache = {};
    if (!global.analyticsCacheTimestamp) global.analyticsCacheTimestamp = {};

    global.analyticsCache[cacheKey] = kpis;
    global.analyticsCacheTimestamp[cacheKey] = now;

    console.log(`✅ Analytics calculated and cached (total: ${Date.now() - apiStartTime}ms)`);

    return res.status(200).json(kpis);

  } catch (error) {
    console.error('Error calculating KPIs:', error);
    return res.status(500).json({
      error: 'Failed to calculate KPIs',
      message: error.message
    });
  }
}
