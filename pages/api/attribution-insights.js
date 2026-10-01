import { db } from '../../lib/firebase';
import { isValidUser } from '../../lib/fraudUsers';
import { requireAuth } from '../../lib/withAuth';

// Test/internal accounts the user wants excluded from analysis (matches
// scripts/attribution-survey-insights.js).
const TEST_ACCOUNTS = new Set([
  'ath.sub.007@gmail.com',
  'trackwork.contact@gmail.com',
  'athahar+f1@gmail.com',
]);

const LAUNCHED_AT_ISO = '2026-05-04';
const LAUNCH_MS = new Date(`${LAUNCHED_AT_ISO}T00:00:00Z`).getTime();
const DAY_MS = 24 * 60 * 60 * 1000;
// Must stay in sync with the survey options in
// foodtoindia/components/AttributionSurvey.js and the VALID_SOURCES in
// foodtoindia/pages/api/attribution/submit.js.
const VALID_SOURCES = ['google', 'ai_search', 'social_media', 'friend', 'other'];

if (!global.attributionInsightsCache) {
  global.attributionInsightsCache = null;
  global.attributionInsightsCacheTimestamp = null;
}
const CACHE_TTL = 60 * 1000;

const isExcludedSender = (email) => {
  if (!email) return false;
  const e = email.toLowerCase().trim();
  if (TEST_ACCOUNTS.has(e)) return true;
  if (!isValidUser(e)) return true;
  return false;
};

// Order snapshots append a risk suffix for the Slack bot. Keep that internal
// metadata out of the attribution customer column when the order is the only
// available identity source.
function cleanSenderName(raw) {
  return (raw || '').replace(/\s*\[Risk Score:[^\]]*\]\s*$/, '').trim();
}

function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function buildDailyBuckets(surveys) {
  const counts = new Map();
  for (const s of surveys) {
    if (!s.createdAt) continue;
    const key = dayKey(s.createdAt);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const todayMs = Date.now();
  const buckets = [];
  for (let t = LAUNCH_MS; t <= todayMs; t += DAY_MS) {
    const key = dayKey(t);
    buckets.push({ date: key, count: counts.get(key) || 0 });
  }
  return buckets;
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
    global.attributionInsightsCache &&
    global.attributionInsightsCacheTimestamp &&
    now - global.attributionInsightsCacheTimestamp < CACHE_TTL;

  if (cacheValid) {
    return res.status(200).json({ ...global.attributionInsightsCache, cached: true });
  }

  try {
    const snap = await db.collection('attribution-surveys').get();
    const rawSurveys = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Look up sender email/name per survey (n is small). Guest profiles keep
    // identity under guestContact by design. Legacy users can have an
    // identity-less parent profile when the Auth onCreate writer missed; their
    // order snapshot remains the durable fallback.
    const enriched = await Promise.all(
      rawSurveys.map(async (s) => {
        if (!s.uid) return { ...s, senderEmail: '', senderName: '' };
        try {
          const userDoc = await db.collection('users').doc(s.uid).get();
          const u = userDoc.exists ? userDoc.data() : {};

          let senderEmail = (u.email || u.guestContact?.email || '').toLowerCase().trim();
          let senderName = u.displayName || u.name || u.guestContact?.name || '';

          if ((!senderEmail || !senderName) && s.orderId) {
            const orderDoc = await db
              .collection('users').doc(s.uid)
              .collection('orders').doc(s.orderId)
              .get();
            const order = orderDoc.exists ? orderDoc.data() : {};
            if (!senderEmail) senderEmail = (order.senderEmail || '').toLowerCase().trim();
            if (!senderName) senderName = cleanSenderName(order.senderName);
          }

          return {
            ...s,
            senderEmail,
            senderName,
          };
        } catch {
          return { ...s, senderEmail: '', senderName: '' };
        }
      })
    );

    const visible = enriched.filter((s) => !isExcludedSender(s.senderEmail));
    const droppedFraud = enriched.length - visible.length;

    const bySource = { google: 0, ai_search: 0, social_media: 0, friend: 0, other: 0 };
    for (const s of visible) {
      if (VALID_SOURCES.includes(s.source)) bySource[s.source] += 1;
    }

    const otherResponses = visible
      .filter((s) => s.source === 'other')
      .map((s) => ({
        id: s.id,
        customText: (s.customText || '').trim(),
        createdAt: s.createdAt || null,
      }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const friendReferrals = visible
      .filter((s) => s.source === 'friend')
      .map((s) => ({
        id: s.id,
        senderEmail: s.senderEmail,
        senderName: s.senderName,
        friendName: (s.friendName || '').trim(),
        friendEmail: (s.friendEmail || '').trim(),
        thankYouSentAt: s.thankYouSentAt || null,
        thankYouFailed: !!s.thankYouFailed,
        thankYouFailReason: s.thankYouFailReason || null,
        createdAt: s.createdAt || null,
      }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    // Full per-respondent list — who answered, what they chose, when.
    // Includes the free-text for "other" and the friend details for
    // "friend" so the admin table can show everything in one place.
    const responses = visible
      .map((s) => ({
        id: s.id,
        senderEmail: s.senderEmail,
        senderName: s.senderName,
        source: VALID_SOURCES.includes(s.source) ? s.source : 'other',
        customText: (s.customText || '').trim(),
        friendName: (s.friendName || '').trim(),
        friendEmail: (s.friendEmail || '').trim(),
        createdAt: s.createdAt || null,
      }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const byDay = buildDailyBuckets(visible);

    const daysSinceLaunch = Math.max(
      1,
      Math.floor((now - LAUNCH_MS) / DAY_MS) + 1
    );

    const payload = {
      totalResponses: visible.length,
      droppedFraud,
      launchedAt: LAUNCHED_AT_ISO,
      daysSinceLaunch,
      bySource,
      byDay,
      responses,
      otherResponses,
      friendReferrals,
      generatedAt: new Date(now).toISOString(),
    };

    global.attributionInsightsCache = payload;
    global.attributionInsightsCacheTimestamp = now;

    return res.status(200).json({ ...payload, cached: false });
  } catch (error) {
    console.error('[attribution-insights] error:', error);
    return res.status(500).json({
      error: 'Failed to load attribution insights',
      message: error.message,
    });
  }
}
