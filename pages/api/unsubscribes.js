import { db } from '../../lib/firebase';
import { requireAuth } from '../../lib/withAuth';

/**
 * All users who unsubscribed from marketing emails, with the context needed to
 * understand the churn: when they unsubscribed, who they are, how many orders
 * they had placed, and when they last ordered.
 *
 * Query note: single equality on the nested flag is auto-indexed; sorting by
 * unsubscribedAt in Firestore would need a composite index, so we sort in
 * memory instead - unsubscribe volumes are small.
 */
export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const snapshot = await db
      .collection('users')
      .where('emailPreferences.unsubscribed', '==', true)
      .get();

    const rows = snapshot.docs.map((doc) => {
      const u = doc.data();
      const unsubscribedAtRaw = u.emailPreferences?.unsubscribedAt || null;
      const unsubscribedAt = unsubscribedAtRaw ? Date.parse(unsubscribedAtRaw) || null : null;
      return {
        uid: doc.id,
        email: u.email || u.guestContact?.email || null,
        isGuest: !u.email && Boolean(u.guestContact?.email),
        name: u.displayName || u.name || u.guestContact?.name || null,
        unsubscribedAt,
        orderCount: Number(u.orderCount) || 0,
        lastOrderAt: Number(u.lastOrderAt) || null,
      };
    });

    // Newest unsubscribes first; rows without a recorded date sink to the end.
    rows.sort((a, b) => (b.unsubscribedAt || 0) - (a.unsubscribedAt || 0));

    return res.status(200).json({ total: rows.length, unsubscribes: rows });
  } catch (error) {
    console.error('[Unsubscribes] Error:', error);
    return res.status(500).json({ error: 'Failed to load unsubscribes', message: error.message });
  }
}
