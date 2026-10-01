import { db } from '../../lib/firebase';
import { requireAuth } from '../../lib/withAuth';
/**
 * POST /api/mark-bounced-unsubscribed
 * Mark bounced emails as unsubscribed
 */
export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { emails } = req.body;

  if (!emails || !Array.isArray(emails)) {
    return res.status(400).json({ error: 'emails array is required' });
  }

  if (!db) {
    return res.status(500).json({
      error: 'Firebase not initialized',
      message: 'Please check your Firebase configuration'
    });
  }

  try {
    const results = {
      success: [],
      notFound: [],
      failed: [],
    };

    const now = new Date().toISOString();

    // Process each email
    for (const email of emails) {
      const normalizedEmail = email.toLowerCase().trim();

      if (!normalizedEmail) continue;

      try {
        // Find user by email
        const snapshot = await db.collection('users')
          .where('email', '==', normalizedEmail)
          .limit(1)
          .get();

        if (snapshot.empty) {
          results.notFound.push(normalizedEmail);
          console.log(`User not found: ${normalizedEmail}`);
          continue;
        }

        const userDoc = snapshot.docs[0];

        // Update email preferences
        await userDoc.ref.update({
          'emailPreferences.unsubscribed': true,
          'emailPreferences.unsubscribedAt': now,
          'emailPreferences.bounced': true,
          'emailPreferences.bouncedAt': now,
        });

        results.success.push(normalizedEmail);
        console.log(`Marked as unsubscribed (bounced): ${normalizedEmail}`);
      } catch (error) {
        results.failed.push({ email: normalizedEmail, error: error.message });
        console.error(`Failed to update ${normalizedEmail}:`, error.message);
      }
    }

    return res.status(200).json({
      success: true,
      total: emails.length,
      processed: results.success.length,
      notFound: results.notFound.length,
      failed: results.failed.length,
      results,
    });
  } catch (error) {
    console.error('Bulk unsubscribe error:', error);
    return res.status(500).json({
      error: 'Failed to process bulk unsubscribe',
      message: error.message
    });
  }
}
