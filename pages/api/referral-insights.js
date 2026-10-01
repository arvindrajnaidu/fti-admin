// GET /api/referral-insights
//
// Powers the admin Referral dashboard. Reads two collections:
//   - referrals            — who referred whom, status, trigger order
//   - referral-transactions — the credit ledger (earned / redeemed)
//
// Referral docs already embed referrer/referee name+email, so no user
// join is needed there. Transaction docs only carry a uid, so those
// are enriched against the users collection.
//
// Money units (verified against foodtoindia/lib/referral.js):
//   - referral-transactions.amount.amountUSD → dollars
//   - users.referralCredits.availableUSD     → cents
//   - referrals.creditAmount.{referrerUSD,refereeUSD} → cents

import { db } from '../../lib/firebase';
import { requireAuth } from '../../lib/withAuth';

if (!global.referralInsightsCache) {
  global.referralInsightsCache = null;
  global.referralInsightsCacheTimestamp = null;
}
const CACHE_TTL = 60 * 1000;

// Referral/transaction timestamps may be epoch ms or Firestore
// Timestamp objects depending on when/how they were written.
function toMillis(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  return null;
}

// Title-case a name for display — "usha gollamudi" → "Usha Gollamudi",
// "BANASHRI" → "Banashri". Customers often type names all-lower or
// all-caps; the dashboard normalizes for readability.
function toTitleCase(name) {
  if (!name || typeof name !== 'string') return '';
  return name.trim().toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!db) {
    return res.status(500).json({ error: 'Firebase not initialized' });
  }

  const now = Date.now();
  const forceRefresh = req.query.forceRefresh === 'true';
  const cacheValid =
    !forceRefresh &&
    global.referralInsightsCache &&
    global.referralInsightsCacheTimestamp &&
    now - global.referralInsightsCacheTimestamp < CACHE_TTL;

  if (cacheValid) {
    return res.status(200).json({ ...global.referralInsightsCache, cached: true });
  }

  try {
    const [referralSnap, txnSnap] = await Promise.all([
      db.collection('referrals').get(),
      db.collection('referral-transactions').get(),
    ]);

    const rawReferrals = referralSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const txns = txnSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Enrich uids → email/name from the users collection. We need:
    //   - referrer uids — the referral doc stores referrer.email as ''
    //     (apply.js never backfills it), so the email must come from
    //     the user doc.
    //   - transaction uids — for the redemptions table.
    const uids = [
      ...new Set(
        [
          ...rawReferrals.map((r) => r.referrer?.uid),
          ...txns.map((t) => t.uid),
        ].filter(Boolean)
      ),
    ];
    const userMap = {};
    await Promise.all(
      uids.map(async (uid) => {
        try {
          const u = await db.collection('users').doc(uid).get();
          const data = u.exists ? u.data() : {};
          userMap[uid] = {
            email: (data.email || '').toLowerCase(),
            name: data.displayName || data.name || '',
          };
        } catch {
          userMap[uid] = { email: '', name: '' };
        }
      })
    );

    // --- Referrals: who referred whom -----------------------------
    const referrals = rawReferrals
      .map((r) => {
        const u = userMap[r.referrer?.uid] || {};
        return {
          id: r.id,
          referrerName: toTitleCase(r.referrer?.name || u.name),
          referrerEmail: (r.referrer?.email || u.email || '').toLowerCase(),
          referrerCode: r.referrer?.code || '',
          refereeName: toTitleCase(r.referee?.name),
          refereeEmail: (r.referee?.email || '').toLowerCase(),
          status: r.status || 'pending',
          triggerOrderId: r.triggerOrderId || null,
          referralCreatedAt: toMillis(r.referralCreatedAt),
          firstOrderCompletedAt: toMillis(r.firstOrderCompletedAt),
        };
      })
      .sort((a, b) => (b.referralCreatedAt || 0) - (a.referralCreatedAt || 0));

    const completed = referrals.filter((r) => r.status === 'completed').length;
    const pending = referrals.length - completed;

    // --- Transactions: the credit ledger --------------------------
    let creditsEarnedUSD = 0;
    let creditsRedeemedUSD = 0;
    const redemptions = [];

    for (const t of txns) {
      const amt = Number(t.amount?.amountUSD) || 0;
      if (t.type === 'earned') creditsEarnedUSD += amt;
      if (t.type === 'redeemed') {
        creditsRedeemedUSD += amt;
        redemptions.push({
          id: t.id,
          customerName: toTitleCase(userMap[t.uid]?.name),
          customerEmail: userMap[t.uid]?.email || '',
          orderId: t.orderId || null,
          amountUSD: amt,
          timestamp: toMillis(t.timestamp),
          notes: t.notes || '',
        });
      }
    }
    redemptions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const payload = {
      totals: {
        totalReferrals: referrals.length,
        completed,
        pending,
        creditsEarnedUSD: Math.round(creditsEarnedUSD * 100) / 100,
        creditsRedeemedUSD: Math.round(creditsRedeemedUSD * 100) / 100,
      },
      referrals,
      redemptions,
      generatedAt: new Date(now).toISOString(),
    };

    global.referralInsightsCache = payload;
    global.referralInsightsCacheTimestamp = now;

    return res.status(200).json({ ...payload, cached: false });
  } catch (error) {
    console.error('[referral-insights] error:', error);
    return res.status(500).json({
      error: 'Failed to load referral insights',
      message: error.message,
    });
  }
}
