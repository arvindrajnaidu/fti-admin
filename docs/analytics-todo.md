# Analytics page — deferred improvements

These items were discussed as part of the April 2026 KPI redesign but deferred so the trend-charts pass could ship first. Each stands alone and can be picked up in any order.

## 1. Remove low-signal sections

**Customer Pipeline** (New / At Risk / Dormant / Churned static horizontal chart)
- Static snapshot, doesn't show trajectory. The cohort retention curve (item 4 below) replaces its intent.
- Where: `pages/analytics.js`, the `<Section title="Customer pipeline">` block.

**"New vs Returning" ratio card**
- Third card in the Growth section. Redundant with the separate New + Returning cards above it.
- Drop it, let the Growth section be two cards.

## 2. Restructure Repeat & New cards to absolute+delta format

User-specified presentation:
```
REPEAT CUSTOMERS
24 vs 20 (+20%) last 30d

NEW CUSTOMERS
22 vs 32 (-31%) last 30d
```

The data is already in the API response (`kpis.customers.repeat`, `kpis.growth.newCustomers`, and their previous-period counterparts). This is a presentation change in `components/data/StatCard.jsx` or a new variant `<ComparisonCard>` with the format `<current> vs <previous> (<delta>%)`.

Currently Repeat rate is shown as `64.4%` — that's a rate, not an absolute count. Decide: keep both (rate card + absolute-count card), or replace.

## 3. Relabel "Revenue / active customer" → "Avg spend per customer"

Single-word rename in `pages/analytics.js`. Same underlying metric (`kpis.revenue.revenuePerActiveCustomer`). The new label is clearer.

## 4. Add Top 10 senders by revenue + cohort retention curve

### Top 10 senders table
- New section listing top-10 customers ranked by `totalSpent` in the selected range
- Columns: Name, Email, Orders, Total spent, % of total revenue
- Surfaces **concentration risk** — if one sender = 20% of revenue, losing them hurts
- Requires API change: `kpis.topSenders` array computed from `customerOrders` map in `pages/api/analytics/kpis.js`

### Cohort retention curve (M1 / M2 / M3)
- For each monthly cohort, show `% of customers who ordered again in month N`
- The single best retention metric for a food-delivery business
- The existing `cohortArray` in the API has `customers` and `repeatRate` (lifetime). Need to extend to return a matrix: `cohorts[month].retention = [M0, M1, M2, M3...]` where each entry is the share of the original cohort that ordered in that subsequent month
- Renders as a standard cohort table or a small-multiples line chart

---

## When you pick this up

All of the above only touch `pages/analytics.js` and `pages/api/analytics/kpis.js`. Shared components in `components/data/` and `components/layout/` are already in place; you won't need to create new primitives.

Build command: `npm run build` — ~10 s on the current machine; will fail fast on type errors or missing imports.
