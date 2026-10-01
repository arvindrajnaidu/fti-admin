import { db, admin } from '../../../lib/firebase';
import { requireAuth } from '../../../lib/withAuth';
import { toTitleCase } from '../../../lib/titleCase';
import {
  ABANDONED_CART_SUBJECTS,
  DEFAULT_SUBJECT_KEY,
  renderSubject,
  resolveRecipientName,
} from '../../../lib/abandonedCartSubjects';
import { Resend } from 'resend';
import { paiseToUsd } from '../../../lib/currency';

const KNOWN_SUBJECT_KEYS = new Set(ABANDONED_CART_SUBJECTS.map((s) => s.key));

/**
 * Manually trigger the abandoned-cart reminder email for a single cart.
 *
 * This is the admin-triggered twin of the cron job at
 * foodtoindia/pages/api/cron/abandoned-cart-reminder.js — it uses the
 * exact same email template so what the admin sends is identical to what
 * the cron will eventually send once it's enabled.
 *
 * POST /api/abandoned-carts/send
 * Body: { checkoutId: string }
 */
export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { checkoutId, subjectKey: requestedKey } = req.body || {};
  if (!checkoutId) {
    return res.status(400).json({ error: 'checkoutId is required' });
  }
  // Server-side whitelist — never trust a raw subject from the client.
  const subjectKey = KNOWN_SUBJECT_KEYS.has(requestedKey) ? requestedKey : DEFAULT_SUBJECT_KEY;

  try {
    const checkoutRef = db.collection('temp-orders').doc(checkoutId);
    const checkoutDoc = await checkoutRef.get();

    if (!checkoutDoc.exists) {
      return res.status(404).json({ error: 'Abandoned cart not found' });
    }

    const checkout = checkoutDoc.data();

    if (checkout.converted === true) {
      return res.status(409).json({ error: 'Cart already converted to an order' });
    }

    const senderEmail = checkout.email || checkout.senderEmail;
    if (!senderEmail) {
      return res.status(400).json({ error: 'Cart has no email to send to' });
    }

    // Check unsubscribe preference (mirror the cron)
    const userSnapshot = await db
      .collection('users')
      .where('email', '==', senderEmail.toLowerCase())
      .limit(1)
      .get();

    if (!userSnapshot.empty) {
      const userData = userSnapshot.docs[0].data();
      if (userData.emailPreferences?.unsubscribed === true) {
        await checkoutRef.update({
          reminderSent: true,
          reminderSkippedReason: 'unsubscribed',
        });
        return res
          .status(409)
          .json({ error: 'Recipient has unsubscribed from reminder emails' });
      }
    }

    const senderName = toTitleCase(
      checkout.displayName || checkout.senderName || checkout.name || 'there',
    );
    const restaurantName =
      checkout.restaurant?.name || checkout.restaurantName || 'the restaurant';
    const recipientName = resolveRecipientName({
      raw: checkout.recipient?.name || checkout.recipientName,
      senderName,
    });
    const subject = renderSubject(subjectKey, { recipient: recipientName, restaurant: restaurantName });

    await sendAbandonedCartEmail({
      email: senderEmail,
      senderName,
      recipientName,
      restaurantName,
      subject,
      cartItems: checkout.cart || checkout.items || [],
      subTotal: checkout.subTotal,
      tax: checkout.tax,
      deliveryFee: checkout.deliveryFee,
      cartDoc: checkout,
      totalAmount: checkout.totalAmount,
      checkoutId,
    });

    await checkoutRef.update({
      reminderSent: true,
      reminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
      reminderSentBy: session.user?.username || 'admin',
      reminderSentSubjectKey: subjectKey,
      reminderSentSubject: subject,
    });

    return res.status(200).json({
      success: true,
      sentTo: senderEmail,
      sentAt: new Date().toISOString(),
      subject,
      subjectKey,
    });
  } catch (err) {
    console.error('[abandoned-carts/send] failed:', err);
    return res.status(500).json({
      error: 'Failed to send abandoned cart reminder',
      message: err.message,
    });
  }
}

/**
 * Verbatim port of sendAbandonedCartEmail from
 * foodtoindia/pages/api/cron/abandoned-cart-reminder.js — keep these in sync
 * when the template changes so manual sends match cron sends exactly.
 */
async function sendAbandonedCartEmail({
  email,
  senderName,
  recipientName,
  restaurantName,
  subject,
  cartItems,
  subTotal,
  tax,
  deliveryFee,
  totalAmount,
  cartDoc,
}) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');

  const toNumber = (value) => {
    const num = typeof value === 'string' ? parseFloat(value) : Number(value);
    return Number.isFinite(num) ? num : 0;
  };
  // Cart paise -> USD at the rate in force when the cart was saved. Dividing
  // by a flat 10000 (Rs 100/$) under-quoted every reminder email.
  // USD-prefixed, not a bare $: this string goes into a CUSTOMER email, and a
  // bare $ has been read as NZD before. The admin UI itself is exempt.
  const formatAmount = (value) => `USD ${paiseToUsd(value, cartDoc).toFixed(2)}`;

  const itemNames = cartItems.map((item) => item?.name).filter(Boolean);
  const visibleNames = itemNames.slice(0, 3);
  const extraItemCount = Math.max(cartItems.length - visibleNames.length, 0);
  const itemsTotal = cartItems.reduce(
    (sum, item) => sum + (item.price || 0) * (item.quantity || 1),
    0,
  );
  const fallbackTotal =
    (toNumber(subTotal) > 0 ? toNumber(subTotal) : itemsTotal) +
    toNumber(tax) +
    toNumber(deliveryFee);
  const totalForSummary = toNumber(totalAmount) > 0 ? toNumber(totalAmount) : fallbackTotal;
  const cartSummary = cartItems.length > 0
    ? `${cartItems.length} items${totalForSummary > 0 ? ` • ${formatAmount(totalForSummary)}` : ''}`
    : 'Your cart';
  const cartItemsSummary = visibleNames.length > 0
    ? `${visibleNames.join(' , ')}${extraItemCount > 0 ? ` and ${extraItemCount} more items` : ''}`
    : '';

  const checkoutUrl = 'https://foodtoindia.com/orders/create';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Sanchez:wght@400;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: #faf1e5; -webkit-font-smoothing: antialiased;">
  <div style="max-width: 440px; margin: 0 auto; padding: 20px;">
    <div style="background: #fff; border-radius: 12px; box-shadow: 0 2px 20px rgba(0,0,0,0.07); overflow: hidden;">
      <div style="padding: 16px 20px; text-align: center; border-bottom: 3px solid #117150;">
        <div style="font-family: 'Sanchez', serif; font-size: 18px; font-weight: 700; color: #117150;">FoodtoIndia</div>
      </div>
      <div style="padding: 24px;">
        <h2 style="font-size: 18px; font-weight: 600; margin: 0 0 8px 0; color: #2D2A26;">Hi ${senderName},</h2>
        <p style="font-size: 14px; line-height: 1.6; color: #444; margin: 0 0 20px 0;">
          ${recipientName
            ? `You left something in your cart! Complete your order for <strong>${recipientName}</strong> from <strong>${restaurantName}</strong>.`
            : `You left something in your cart from <strong>${restaurantName}</strong>. It's still waiting for you.`}
        </p>
        <div style="background: #faf8f5; border-radius: 8px; padding: 16px; margin: 16px 0 20px;">
          <div style="font-size: 13px; color: #8A8279; margin-bottom: 6px;">YOUR CART</div>
          <div style="font-size: 14px; color: #2D2A26; line-height: 1.5; margin-bottom: 4px;">${cartSummary}</div>
          <div style="font-size: 13px; color: #6b655d; line-height: 1.5;">${cartItemsSummary}</div>
        </div>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${checkoutUrl}" style="display: inline-block; padding: 14px 40px; background-color: #117150; color: #ffffff; text-decoration: none; border-radius: 9999px; font-weight: 700; font-size: 15px; letter-spacing: 0.01em;">
            Complete My Order
          </a>
        </div>
        <p style="font-size: 13px; color: #8A8279; line-height: 1.5; margin: 20px 0 0; text-align: center;">
          Same-day delivery in 500+ cities • Pay in USD • Payments secured by Stripe
        </p>
      </div>
      <div style="padding: 20px; text-align: center; font-size: 12px; color: #aaa; border-top: 1px solid #f0f0f0;">
        Follow us on Instagram: <a href="https://www.instagram.com/food2india" style="color: #667085; text-decoration: none; font-weight: 500;">@food2india</a><br>
        <a href="https://www.foodtoindia.com" style="color: #667085; text-decoration: none;">foodtoindia.com</a><br>
        <a href="https://www.foodtoindia.com/unsubscribe?email=${encodeURIComponent(email)}" style="color: #aaa; text-decoration: underline; font-size: 11px;">Unsubscribe</a>
      </div>
    </div>
  </div>
</body>
</html>`;

  const resend = new Resend(RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: 'FoodtoIndia <orders@foodtoindia.com>',
    to: [email],
    subject: subject || (recipientName ? `Complete your order for ${recipientName}` : 'Complete your order'),
    html,
    replyTo: 'support@foodtoindia.com',
  });

  if (error) throw new Error(`Resend error: ${error.message}`);
  return data;
}
