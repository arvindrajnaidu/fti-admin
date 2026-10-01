import { getIronSession } from 'iron-session';

function resolveSessionPassword() {
  if (process.env.SESSION_SECRET) {
    return process.env.SESSION_SECRET;
  }

  if (process.env.SESSION_PASSWORD) {
    return process.env.SESSION_PASSWORD;
  }

  // Allow local development without forcing secret setup.
  if (process.env.NODE_ENV !== 'production') {
    return 'dev-only-foodtoindia-admin-session-password-2026';
  }

  throw new Error(
    'Missing session password. Set SESSION_SECRET (or SESSION_PASSWORD).'
  );
}

export const sessionOptions = {
  password: resolveSessionPassword(),
  cookieName: 'foodtoindia-admin-session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 1 week
  },
};

export async function getSession(req, res) {
  return await getIronSession(req, res, sessionOptions);
}
