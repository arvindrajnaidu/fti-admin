import { useState } from 'react';
import { mapsUrlForOrder, mapsEmbedUrlForOrder } from '../../lib/orderDelivery';

// Inline Google Maps iframe shown right under the recipient address -
// keeps ops in the admin app instead of context-switching to their
// personal Google Maps (which on mobile deep-links to the native app).
// Expanded by default so ops sees the pin immediately when the order
// detail modal opens; a "Hide map" toggle collapses it for the rare
// long-list scroll case. The escape-hatch "Open in Maps" link stays as
// a secondary affordance, for when ops wants directions.
//
// Silent no-op when the order has no usable pin coords (returns null),
// so older orders predating the recipient-pin flow render unchanged.
export function MapsPreview({ order }) {
  const [expanded, setExpanded] = useState(true);
  const embedUrl = mapsEmbedUrlForOrder(order);
  const externalUrl = mapsUrlForOrder(order);
  if (!embedUrl) return null;

  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-3 text-[12px]">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 rounded font-medium text-accent hover:underline focus:outline-none focus:ring-2 focus:ring-accent/30"
          aria-expanded={expanded}
        >
          <span aria-hidden="true">🗺️</span>
          {expanded ? 'Hide map' : 'Show map'}
        </button>
        {externalUrl ? (
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-ink-500 hover:text-accent hover:underline"
          >
            <span aria-hidden="true">📍</span>
            Open in Maps
          </a>
        ) : null}
      </div>
      {expanded ? (
        <div className="mt-1.5 overflow-hidden rounded-md border border-ink-200">
          <iframe
            title="Recipient pin location"
            src={embedUrl}
            style={{ border: 0, width: '100%', height: 240, display: 'block' }}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      ) : null}
    </div>
  );
}
