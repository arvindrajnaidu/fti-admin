import { getSession } from './session';

/**
 * Higher-order function to wrap getServerSideProps with authentication
 * @param {Function} getServerSidePropsFunc - Optional getServerSideProps to run after auth check
 * @returns {Function} - getServerSideProps that checks authentication
 */
export function withAuth(getServerSidePropsFunc) {
  return async function getServerSideProps(context) {
    const { req, res } = context;
    const session = await getSession(req, res);

    if (!session.user) {
      return {
        redirect: {
          destination: '/login',
          permanent: false,
        },
      };
    }

    // If there's a custom getServerSideProps, run it
    if (getServerSidePropsFunc) {
      const result = await getServerSidePropsFunc(context, session);

      // If it returns a redirect or notFound, return as-is
      if (result.redirect || result.notFound) {
        return result;
      }

      // Merge props with user info
      return {
        props: {
          ...result.props,
          user: session.user,
        },
      };
    }

    // Default: just return the user
    return {
      props: {
        user: session.user,
      },
    };
  };
}

/**
 * Helper to require auth in API routes
 */
export async function requireAuth(req, res) {
  const session = await getSession(req, res);

  if (!session.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  return session;
}
