import Head from 'next/head';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import '../styles/admin.css';

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className={`${plexSans.variable} ${plexMono.variable}`}>
        <Component {...pageProps} />
      </div>
    </>
  );
}
