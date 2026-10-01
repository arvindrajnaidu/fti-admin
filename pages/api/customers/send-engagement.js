import { db, admin } from '../../../lib/firebase';
import { requireAuth } from '../../../lib/withAuth';
import { toTitleCase } from '../../../lib/titleCase';
import { buildEngagementEmail, VALID_CAMPAIGN_TYPES } from '../../../lib/engagementEmails';
import { Resend } from 'resend';

const COOLDOWN_DAYS = 60;
const COOLDOWN_MS = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
const VALID_TYPES = new Set(VALID_CAMPAIGN_TYPES);

/**
 * POST /api/customers/send-engagement
 * Body: { email: string, campaignType: 'winback' | 'feedback' }
 *
 * Sends a re-engagement email (win-back or feedback request) to a customer.
 * Mirrors the send pattern in pages/api/abandoned-carts/send.js — same
 * Resend sender, same suppression check, same per-record send-tracking
 * shape (here on the user document under engagementHistory).
 */
export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email: rawEmail, campaignType } = req.body || {};
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

    if (userSnapshot.empty) {
      return res.status(404).json({ error: 'No user found with that email' });
    }

    const userDoc = userSnapshot.docs[0];
    const userData = userDoc.data();

    if (userData.emailPreferences?.unsubscribed === true) {
      return res.status(400).json({
        error: 'Customer is unsubscribed from emails',
        code: 'UNSUBSCRIBED',
      });
    }

    const lastSent = userData.engagementHistory?.[campaignType]?.sentAt;
    const lastSentMs = toMillis(lastSent);
    if (lastSentMs && Date.now() - lastSentMs < COOLDOWN_MS) {
      return res.status(400).json({
        error: `Already sent within the last ${COOLDOWN_DAYS} days`,
        code: 'COOLDOWN',
        lastSentAt: new Date(lastSentMs).toISOString(),
      });
    }

    const displayName = toTitleCase(userData.displayName || userData.name || '');
    const firstName = displayName ? displayName.split(' ')[0] : '';

    const { subject, html } = buildEngagementEmail({
      campaignType,
      name: firstName,
      email,
    });

    await sendEngagementEmail({ email, subject, html });

    await userDoc.ref.set(
      {
        engagementHistory: {
          [campaignType]: {
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            sentBy: session.user?.username || 'admin',
            subject,
          },
        },
      },
      { merge: true },
    );

    return res.status(200).json({
      success: true,
      sentTo: email,
      campaignType,
      sentAt: new Date().toISOString(),
      subject,
    });
  } catch (err) {
    console.error('[customers/send-engagement] failed:', err);
    return res.status(500).json({
      error: 'Failed to send engagement email',
      message: err.message,
    });
  }
}

function toMillis(value) {
  if (!value) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value._seconds) return value._seconds * 1000;
  return null;
}

async function sendEngagementEmail({ email, subject, html }) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');

  const resend = new Resend(RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: 'FoodtoIndia <orders@foodtoindia.com>',
    to: [email],
    subject,
    html,
    replyTo: 'support@foodtoindia.com',
  });

  if (error) throw new Error(`Resend error: ${error.message}`);
  return data;
}
