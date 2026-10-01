import { db } from '../../lib/firebase';
import { paiseToUsd } from '../../lib/currency';
import { requireAuth } from '../../lib/withAuth';
/**
 * GET /api/abandoned-carts
 * Fetch abandoned carts (temp-orders that weren't completed)
 * Shows last 30 days, with reminder status
 */
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

    // Get temp-orders from last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    console.log('Fetching abandoned carts since:', thirtyDaysAgo);

    const snapshot = await db.collection('temp-orders')
      .where('createdAt', '>=', thirtyDaysAgo)
      .orderBy('createdAt', 'desc')
      .limit(500)
      .get();

    console.log(`Found ${snapshot.size} temp-orders`);

    const abandonedCarts = [];

    snapshot.forEach(doc => {
      const data = doc.data();

      const toNumber = (value) => {
        const num = typeof value === 'string' ? parseFloat(value) : Number(value);
        return Number.isFinite(num) ? num : 0;
      };

      // Calculate cart total (prefer totalAmount, which includes taxes + delivery)
      const cartItems = data.cart || data.items || [];
      const itemsTotal = cartItems.reduce((sum, item) => {
        return sum + ((item.price || 0) * (item.quantity || 1));
      }, 0);
      const subTotal = toNumber(data.subTotal);
      const tax = toNumber(data.tax);
      const deliveryFee = toNumber(data.deliveryFee);
      const totalAmount = toNumber(data.totalAmount);
      const cartTotal =
        totalAmount > 0
          ? totalAmount
          : (subTotal > 0 ? (subTotal + tax + deliveryFee) : (itemsTotal + tax + deliveryFee));

      // Format created date
      let createdAt = null;
      if (data.createdAt) {
        if (typeof data.createdAt === 'number') {
          createdAt = new Date(data.createdAt).toISOString();
        } else if (data.createdAt.toDate) {
          createdAt = data.createdAt.toDate().toISOString();
        } else if (data.createdAt instanceof Date) {
          createdAt = data.createdAt.toISOString();
        }
      }

      // Format reminder sent date
      let reminderSentAt = null;
      if (data.reminderSentAt) {
        if (typeof data.reminderSentAt === 'number') {
          reminderSentAt = new Date(data.reminderSentAt).toISOString();
        } else if (data.reminderSentAt.toDate) {
          reminderSentAt = data.reminderSentAt.toDate().toISOString();
        } else if (data.reminderSentAt instanceof Date) {
          reminderSentAt = data.reminderSentAt.toISOString();
        }
      }

      // Format converted date
      let convertedAt = null;
      if (data.convertedAt) {
        if (typeof data.convertedAt === 'number') {
          convertedAt = new Date(data.convertedAt).toISOString();
        } else if (data.convertedAt.toDate) {
          convertedAt = data.convertedAt.toDate().toISOString();
        } else if (data.convertedAt instanceof Date) {
          convertedAt = data.convertedAt.toISOString();
        }
      }

      abandonedCarts.push({
        id: doc.id,
        email: data.email || data.senderEmail || 'N/A',
        name: data.displayName || data.senderName || 'N/A',
        recipientName: data.recipient?.name || 'N/A',
        restaurantName: data.restaurant?.name || 'N/A',
        cartItemNames: cartItems.map((item) => item?.name).filter(Boolean),
        // USD at the rate in force when the cart was saved (carts have no
        // paymentIntent, so the stamped/dated rate is the best source).
        cartTotal: paiseToUsd(cartTotal, data),
        subTotal: subTotal,
        tax: tax,
        deliveryFee: deliveryFee,
        totalAmount: totalAmount,
        itemCount: cartItems.length,
        createdAt: createdAt,
        reminderSent: data.reminderSent || false,
        reminderSentAt: reminderSentAt,
        status: data.status || 'pending',
        converted: data.converted || false,
        convertedAt: convertedAt,
        convertedAfterReminder: data.convertedAfterReminder || false,
        orderId: data.orderId || null,
      });
    });

    console.log(`Returning ${abandonedCarts.length} abandoned carts`);

    return res.status(200).json({
      carts: abandonedCarts,
      total: abandonedCarts.length,
    });

  } catch (error) {
    console.error('Error fetching abandoned carts:', error);
    return res.status(500).json({
      error: 'Failed to fetch abandoned carts',
      message: error.message,
    });
  }
}
