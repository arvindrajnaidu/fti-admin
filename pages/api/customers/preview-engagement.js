import { db } from '../../../lib/firebase';
import { requireAuth } from '../../../lib/withAuth';
import { toTitleCase } from '../../../lib/titleCase';
import { buildEngagementEmail, VALID_CAMPAIGN_TYPES } from '../../../lib/engagementEmails';

const VALID_TYPES = new Set(VALID_CAMPAIGN_TYPES);

/**
 * GET /api/customers/preview-engagement?email=...&campaignType=winback|feedback
 *
 * Returns the rendered subject + html for the given customer + campaign,
 * without sending. Used by the admin UI to show a preview modal before
 * confirming a send. Same renderer as send-engagement.js — guaranteed
 * identical output.
 */
export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email: rawEmail, campaignType } = req.query || {};
  if (!rawEmail) {
    return res.status(400).json({ error: 'email is required' });
  }
  if (!VALID_TYPES.has(campaignType)) {
    return res.status(400).json({ error: 'campaignType must be "winback" or "feedback"' });
  }

  const email = String(rawEmail).toLowerCase().trim();

  try {
    const userSnapshot = await db
      .collection('users')
      .where('email', '==', email)
      .limit(1)
      .get();

    let firstName = '';
    if (!userSnapshot.empty) {
      const userData = userSnapshot.docs[0].data();
      const displayName = toTitleCase(userData.displayName || userData.name || '');
      firstName = displayName ? displayName.split(' ')[0] : '';
    }

    const { subject, html } = buildEngagementEmail({
      campaignType,
      name: firstName,
      email,
    });

    return res.status(200).json({ subject, html, recipient: email, campaignType });
  } catch (err) {
    console.error('[customers/preview-engagement] failed:', err);
    return res.status(500).json({
      error: 'Failed to render preview',
      message: err.message,
    });
  }
}
