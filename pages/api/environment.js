import { requireAuth } from '../../lib/withAuth';

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Use FIREBASE_ENV instead of NODE_ENV because Next.js dev mode forces NODE_ENV=development
  const isProduction = process.env.FIREBASE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
  const environment = isProduction ? 'production' : 'development';

  return res.status(200).json({
    environment,
    isProduction,
  });
}
