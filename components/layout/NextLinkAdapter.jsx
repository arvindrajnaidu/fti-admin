import NextLink from 'next/link';
import { forwardRef } from 'react';

export const NextLinkAdapter = forwardRef(function NextLinkAdapter(
  { href, to, ...rest },
  ref,
) {
  return <NextLink ref={ref} href={href ?? to ?? '#'} {...rest} />;
});
