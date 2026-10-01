import bcrypt from 'bcryptjs';
import { getSession } from '../../../lib/session';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  // Get expected credentials from environment
  const expectedUsername = process.env.AUTH_USERNAME;
  const expectedPasswordHash = process.env.AUTH_PASSWORD_HASH;

  if (!expectedUsername || !expectedPasswordHash) {
    console.error('Auth environment variables not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Verify credentials
  const usernameMatch = username === expectedUsername;
  const passwordMatch = await bcrypt.compare(password, expectedPasswordHash);

  if (!usernameMatch || !passwordMatch) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Create session
  const session = await getSession(req, res);
  session.user = {
    username,
    loggedInAt: new Date().toISOString(),
  };
  await session.save();

  return res.status(200).json({ success: true });
}
