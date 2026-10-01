import { db, admin } from '../../lib/firebase';
import { requireAuth } from '../../lib/withAuth';
export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (!db) {
    return res.status(500).json({
      error: 'Firebase not initialized',
      message: 'Please check your Firebase configuration in .env.local'
    });
  }

  try {
    switch (req.method) {
      case 'GET':
        return await listPromoCodes(req, res);
      case 'POST':
        return await createPromoCode(req, res);
      case 'PUT':
        return await updatePromoCode(req, res);
      case 'DELETE':
        return await deletePromoCode(req, res);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Promo codes API error:', error);
    return res.status(500).json({
      error: 'Failed to process request',
      message: error.message,
    });
  }
}

async function listPromoCodes(req, res) {
  const snapshot = await db.collection('promo-codes')
    .orderBy('createdAt', 'desc')
    .get();

  const promoCodes = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || doc.data().createdAt,
    expiresAt: doc.data().expiresAt?.toDate?.()?.toISOString() || doc.data().expiresAt,
  }));

  return res.status(200).json({ promoCodes });
}

async function createPromoCode(req, res) {
  const {
    code,
    type,
    value,
    minOrderUSD,
    maxDiscountUSD,
    expiresAt,
  } = req.body;

  // Validation
  if (!code || !type || value === undefined) {
    return res.status(400).json({ error: 'Code, type, and value are required' });
  }

  if (!['percent', 'fixed'].includes(type)) {
    return res.status(400).json({ error: 'Type must be "percent" or "fixed"' });
  }

  if (type === 'percent' && (value < 0 || value > 100)) {
    return res.status(400).json({ error: 'Percent value must be between 0 and 100' });
  }

  const normalizedCode = code.toUpperCase().trim();

  // Check if code already exists
  const existingSnapshot = await db.collection('promo-codes')
    .where('code', '==', normalizedCode)
    .limit(1)
    .get();

  if (!existingSnapshot.empty) {
    return res.status(400).json({ error: 'Promo code already exists' });
  }

  const promoCodeData = {
    code: normalizedCode,
    type,
    value: Number(value),
    minOrderUSD: minOrderUSD ? Number(minOrderUSD) : null,
    maxDiscountUSD: maxDiscountUSD ? Number(maxDiscountUSD) : null,
    expiresAt: expiresAt ? admin.firestore.Timestamp.fromDate(new Date(expiresAt)) : null,
    isActive: true,
    totalRedemptions: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const docRef = await db.collection('promo-codes').add(promoCodeData);

  return res.status(201).json({
    id: docRef.id,
    ...promoCodeData,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt || null,
  });
}

async function updatePromoCode(req, res) {
  const { id, ...updates } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Promo code ID is required' });
  }

  const docRef = db.collection('promo-codes').doc(id);
  const doc = await docRef.get();

  if (!doc.exists) {
    return res.status(404).json({ error: 'Promo code not found' });
  }

  // Build allowed updates
  const allowedUpdates = {};

  // Code update - check for duplicates if changing
  if (updates.code !== undefined) {
    const normalizedCode = updates.code.toUpperCase().trim();
    const currentData = doc.data();

    if (normalizedCode !== currentData.code) {
      const existingSnapshot = await db.collection('promo-codes')
        .where('code', '==', normalizedCode)
        .limit(1)
        .get();

      if (!existingSnapshot.empty) {
        return res.status(400).json({ error: 'Promo code already exists' });
      }
    }
    allowedUpdates.code = normalizedCode;
  }

  // Type update
  if (updates.type !== undefined) {
    if (!['percent', 'fixed'].includes(updates.type)) {
      return res.status(400).json({ error: 'Type must be "percent" or "fixed"' });
    }
    allowedUpdates.type = updates.type;
  }

  // Value update
  if (updates.value !== undefined) {
    const type = updates.type || doc.data().type;
    if (type === 'percent' && (updates.value < 0 || updates.value > 100)) {
      return res.status(400).json({ error: 'Percent value must be between 0 and 100' });
    }
    allowedUpdates.value = Number(updates.value);
  }

  if (updates.isActive !== undefined) {
    allowedUpdates.isActive = updates.isActive;
  }
  if (updates.minOrderUSD !== undefined) {
    allowedUpdates.minOrderUSD = updates.minOrderUSD ? Number(updates.minOrderUSD) : null;
  }
  if (updates.maxDiscountUSD !== undefined) {
    allowedUpdates.maxDiscountUSD = updates.maxDiscountUSD ? Number(updates.maxDiscountUSD) : null;
  }
  if (updates.expiresAt !== undefined) {
    allowedUpdates.expiresAt = updates.expiresAt
      ? admin.firestore.Timestamp.fromDate(new Date(updates.expiresAt))
      : null;
  }

  await docRef.update(allowedUpdates);

  return res.status(200).json({ id, ...allowedUpdates });
}

async function deletePromoCode(req, res) {
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Promo code ID is required' });
  }

  const docRef = db.collection('promo-codes').doc(id);
  const doc = await docRef.get();

  if (!doc.exists) {
    return res.status(404).json({ error: 'Promo code not found' });
  }

  await docRef.delete();

  return res.status(200).json({ success: true });
}
