# CLAUDE.md — admin app

## Stack (as of April 2026)

- **Next.js 15** (Pages Router), **React 18.3**, **Tailwind v4** (CSS-first config in `styles/admin.css`), **Cloudflare Kumo 1.19**
- Fonts: **IBM Plex Sans + IBM Plex Mono** via `next/font/google` (see `pages/_app.js`)
- Design tokens ported verbatim from `/Users/athahar/work/claude-apps/upcraft/trackwork-internal/DESIGN_TOKENS.md` — ink-0..900, accent, success/warn/danger fg+weak, tracking-micro 0.08em
- Build: `npm run build`. Install: `npm install --legacy-peer-deps` (stale Next 11 transitive peers).

## Deploy

- **Separate git repo** from the consumer app: `github.com/athahar/f2i-admin.git`, at `/Users/athahar/work/claude-apps/food2India/admin`.
- **Push to `main` → auto-deploys on Vercel** (https://f2i-admin-foodtoindia.vercel.app). That is the intended deploy path: `git push origin main` and Vercel builds + ships.
- This is UNRELATED to the consumer app's "never push main / use stage" rule - that rule applies to the `foodtoindia` repo only. Here, `main` IS the deploy branch.
- Commit only intended files. The working tree carries pre-existing noise (test-*.js, check-*.js, data/*.csv, .gstack/, .playwright-mcp/) - do not stage those.

## Key files

- `styles/admin.css` — Tailwind v4 `@theme inline` block aliases raw tokens to `--color-*` utilities. Also contains CSS overrides compensating for Kumo's v3-`!`-prefix class strings that don't emit under v4 (primary-button white text, secondary-button ink-700 text, Kumo Input visible border, Kumo Button padding).
- `components/layout/AdminShell.jsx` — left sidebar + sticky top header + main container. Collapse toggle persists via `localStorage['admin-sidebar-collapsed']`.
- `components/layout/PageHeader.jsx` — trackwork PageHeader exact port (22px semibold title, 18px ink-400 phosphor icon, 13px ink-500 subtitle, segmented filter pills).
- `components/layout/Modal.jsx` — shared overlay + panel with X close.
- `components/data/DataTable.jsx` — `TableShell/Th/Tr/Td/Pill/Dash/IconButton` primitives.
- `components/data/StatCard.jsx` — trackwork KpiCard. Pass `current={rawNumber}` alongside `value={formattedString}` when the display is currency/percent — `parseFloat('$824')` returns NaN.
- `components/data/TrendChart.jsx` — CSS-flex bar chart for time-series data. No echarts dependency.
- `pages/design-test.js` — DESIGN_TOKENS.md Section 6 verification page at `/design-test` (no auth).
- `docs/kumo-migration-notes.md` — per-page migration checklist from the initial redesign.

## Pages

- Fully migrated: `/` (orders), `/analytics`, `/store-credits`, `/promo-codes`, `/abandoned-carts`
- Shell + PageHeader only (bodies still have inline styles, color-tokenized): `/customers`, `/email-templates`, `/email-campaigns`, `/inbox`

## Deferred work

Short lists of pending follow-ups by area — pick up in any order:

- **`docs/analytics-todo.md`** — analytics page KPI redesign (remove Customer Pipeline, restructure repeat/new cards to absolute+delta, relabel Revenue/Active → Avg spend, add Top 10 senders + cohort retention curve)

## Gotchas

- **Kumo + Tailwind v4 interop**: Kumo ships `!text-*`, `!border-*` etc. using Tailwind v3's prefix-important syntax. Tailwind v4 uses suffix-`!`. Most of these classes don't emit. Symptom: invisible text, missing borders, cramped padding. Fix with explicit CSS in `styles/admin.css` or swap to native `<input>` / `<button>` with explicit trackwork classes. Don't try to make Kumo's `<Input>` / `<Button size="sm">` work unmodified.
- **API routes must use `import`, not `require`**: Next 15's SWC returns ESM modules differently when `require()`'d from a file that also uses `export default`. All 17 API routes were converted to ESM imports. Don't regress.
- **Bundle size**: `@cloudflare/kumo` ships `echarts` as a peer (~200 kB). Avoid pulling it in — the `TrendChart` component is CSS-only to keep bundles lean.
- **Trend arrows**: `StatCard` now takes an optional `current` prop. Always pass it when value is currency/percent formatted, otherwise `parseFloat('$824.96')` returns NaN and the trend shows -100%.

## Recurring analyses (run monthly)

Run on the 1st of each month and review with the user — they care about
the trend, not the absolute numbers in isolation:

- **`scripts/top-customer-concentration.js`** — pulls every user + their
  orders subcollection from Firestore, splits orders into a recent 5-month
  window vs. all earlier history, and reports top-8 share of revenue,
  per-customer monthly intensity, overlap between the two top-8 sets, and a
  per-name P1-vs-P2 split for the all-time top 8. Loads `.env.local`
  directly (same pattern as `scripts/test-resend-sdk.js`), so it talks to
  the prod Firebase project (`FIREBASE_ENV=production` in env). Window
  boundaries are constants at the top of the file — adjust `PERIOD1_START`
  / `PERIOD1_END` / `PERIOD1_MONTHS` to roll forward each month.

  Run: `NODE_OPTIONS='--openssl-legacy-provider' node scripts/top-customer-concentration.js`

  The user's hypothesis as of May 2026 was "reliance on top customers has
  reduced in the last 4-5 months" — confirmed, but the underlying story is
  whales lapsing, not new customers diluting them. Surface both sides when
  reporting.

## Accuracy - standing rule (don't infer existence from a check)

Same rule as the foodtoindia CLAUDE.md (the address-pin work surfaced
this defect in May 2026). Repeated here because it applies anywhere
I'm working.

Don't assert what code does without tracing both the READ and the
WRITE path. Existence of a check is NOT evidence of existence of
data. Specifically:

- "X is set by ...": grep the write path before claiming the source.
- "Only X writes Y" / "Only ops can ...": grep for ALL writers, or
  the narrowing produces a second lie.
- "This works like this:" followed by a flow: trace the flow
  end-to-end. Reading a receiver doesn't tell you the sender wrote
  anything.
- Default to qualified language: "X reads Y; write path unverified"
  beats "X is set by Z" when verification isn't done.

When called out on a wrong claim, RE-VERIFY THE WHOLE CLAIM, not
just the challenged part. See memory `feedback_dont-lie-trace-both-paths`
and `feedback_principle-not-symptom`.

Concrete trigger: I lied saying `recipientContact.confirmedAddress.lat/lng`
was set by ops or the recipient. Neither flow wrote those fields - the
check was dead code I had written. When narrowed to "only ops" without
verification, lied again because the admin Confirm modal is also text-only.

## Running on the user's machine

- User runs their own dev server on port 3001. **Don't start a dev server on 3001 yourself** — verify via `npm run build` only.
- The working tree has pre-existing noise (test-*.js, check-*.js, .env.local.* deletions) carried over from main. Don't stage those.
