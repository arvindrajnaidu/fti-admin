import { db, admin } from '../../lib/firebase';
import { requireAuth } from '../../lib/withAuth';
export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (req.method === 'GET') {
    return handleList(req, res);
  } else if (req.method === 'POST') {
    return handleCreate(req, res, session);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

async function handleList(req, res) {
  try {
    const snapshot = await db.collection('promo-codes')
      .where('isStoreCredit', '==', true)
      .orderBy('createdAt', 'desc')
      .get();

    const credits = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        code: data.code,
        type: data.type,
        value: data.value, // cents
        customerId: data.customerId,
        customerEmail: data.customerEmail,
        sourceOrderId: data.sourceOrderId,
        reason: data.reason,
        issuedBy: data.issuedBy,
        isActive: data.isActive,
        totalRedemptions: data.totalRedemptions || 0,
        createdAt: data.createdAt?.toDate?.() ? data.createdAt.toDate().toISOString() : data.createdAt,
        issuedAt: data.issuedAt?.toDate?.() ? data.issuedAt.toDate().toISOString() : data.issuedAt,
        expiresAt: data.expiresAt?.toDate?.() ? data.expiresAt.toDate().toISOString() : data.expiresAt,
      };
    });

    return res.status(200).json({ credits });
  } catch (error) {
    console.error('Error listing store credits:', error);
    return res.status(500).json({ error: 'Failed to list store credits' });
  }
}

async function handleCreate(req, res, session) {
  try {
    const { customerId, customerEmail, amountUSD, reason, sourceOrderId } = req.body;

    if (!customerId || !customerEmail) {
      return res.status(400).json({ error: 'Customer ID and email are required' });
    }
    if (!amountUSD || amountUSD <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Reason is required' });
    }

    // Generate unique SC- code
    let code = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateStoreCreditCode();
      const existing = await db.collection('promo-codes')
        .where('code', '==', candidate)
        .limit(1)
        .get();
      if (existing.empty) {
        code = candidate;
        break;
      }
    }

    if (!code) {
      return res.status(500).json({ error: 'Failed to generate unique code. Please try again.' });
    }

    const valueInCents = Math.round(amountUSD * 100);
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    const promoDoc = {
      code,
      type: 'fixed',
      value: valueInCents,
      isActive: true,
      totalRedemptions: 0,
      isStoreCredit: true,
      customerId,
      customerEmail,
      sourceOrderId: sourceOrderId || null,
      reason: reason.trim(),
      issuedBy: session.user?.email || 'admin',
      issuedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      minOrderUSD: null,
      maxDiscountUSD: null,
    };

    await db.collection('promo-codes').add(promoDoc);

    // Write back-reference to the source order for audit trail
    if (sourceOrderId && customerId) {
      try {
        await db.collection('users').doc(customerId)
          .collection('orders').doc(sourceOrderId)
          .update({
            storeCreditIssued: true,
            storeCreditCode: code,
            storeCreditAmount: valueInCents,
            storeCreditReason: reason.trim(),
            storeCreditIssuedBy: session.user?.email || 'admin',
            storeCreditIssuedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        // Invalidate orders cache since we modified an order
        global.ordersCache = null;
      } catch (orderErr) {
        console.error('Failed to write store credit back-reference to order:', orderErr);
        // Don't fail — the credit was created successfully
      }
    }

    return res.status(200).json({
      success: true,
      code,
      message: `Store credit ${code} issued for $${amountUSD.toFixed(2)}`,
    });
  } catch (error) {
    console.error('Error creating store credit:', error);
    return res.status(500).json({ error: 'Failed to create store credit' });
  }
}

function generateStoreCreditCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No ambiguous O/0/1/I
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `SC-${suffix}`;
}
