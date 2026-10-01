/**
 * Restaurant-to-recipient distance for an order, as a display string.
 *
 * Sources, best first:
 *   1. restaurantRoadKm    - Swiggy's own road distance (sla.lastMileTravel),
 *                            stamped at order time since pricing-v3 (2026-08-11).
 *                            This is the number the delivery fee is priced on.
 *   2. restaurantDistanceKm - straight-line haversine. Only present on 51 orders
 *                            from 2026-05-10..12, when radius enforcement was
 *                            briefly on, plus anything backfilled.
 *
 * Returns null when neither exists, so callers render nothing rather than a
 * misleading zero. Orders placed before the stamp shipped simply have no
 * distance, and that is honest.
 */
const orderDistanceKm = (order) => {
  const road = Number(order?.restaurantRoadKm);
  if (Number.isFinite(road) && road > 0) return { km: road, kind: 'road' };
  const crow = Number(order?.restaurantDistanceKm);
  if (Number.isFinite(crow) && crow > 0) return { km: crow, kind: 'straight-line' };
  return null;
};

/** "9.8 km away" / "2.1 km away (straight-line)" / null. */
const formatOrderDistance = (order) => {
  const d = orderDistanceKm(order);
  if (!d) return null;
  const n = d.km >= 10 ? d.km.toFixed(1) : d.km.toFixed(1);
  return d.kind === 'road' ? `${n} km away` : `${n} km away (straight-line)`;
};

module.exports = { orderDistanceKm, formatOrderDistance };
