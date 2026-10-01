# Kumo migration notes

Captured during the pilot migration of `pages/analytics.js` on branch `migrate/next14-kumo`. Use this as a checklist when migrating the remaining 9 pages.

## Stack (post-Phase-A)

- Next.js 15.x (Pages Router) — `legacyBehavior` prop on every `<Link>` preserves the nested-`<a>` pattern used throughout the codebase. Do not need to touch the nav Link usage; just keep adding `legacyBehavior` to any new Links created during migration.
- React 18.3.x
- Tailwind v4 (`@tailwindcss/postcss`, CSS-first config via `@source` in `styles/admin.css`)
- `@cloudflare/kumo` v1.19 — requires Tailwind v4 + Next 15. Installed with `--legacy-peer-deps` because stale Next 11 transitive peers linger in `node_modules`; this is cosmetic, the real tree is clean.
- `_app.js` wraps the tree in `<LinkProvider component={NextLinkAdapter}>` + `<Toasty>`. Any Kumo Link-like component will route through `next/link` via the adapter.

## Semantic tokens (use these, never raw Tailwind colors)

| Purpose | Class |
|---|---|
| Page canvas | `bg-kumo-canvas` |
| Card/surface | `bg-kumo-base` |
| Control surface (inputs, toasts) | `bg-kumo-control` |
| Primary text | `text-kumo-default` |
| Muted/secondary text | `text-kumo-subtle` |
| Emphasized headings | `text-kumo-strong` |
| Brand accent | `text-kumo-brand` / `bg-kumo-brand` |
| Info | `text-kumo-info` / `bg-kumo-info-tint` |
| Success | `text-kumo-success` |
| Warning | `text-kumo-warning` |
| Danger/error | `text-kumo-danger` / `bg-kumo-danger-tint` |
| Subtle border | `border-kumo-hairline` |
| Fill border | `border-kumo-fill` |

**No `dark:` variants.** Kumo handles dark mode via CSS `light-dark()` under the hood — pages/components should be colour-mode agnostic.

## Per-page migration checklist

For each non-pilot page:

1. **Wrap the page body in `<AdminShell environment={environment}>`.** Drop the duplicated tab-nav and top-right environment badge / logout button that exists in every page today — AdminShell owns all of that now.
2. **Remove the environment fetch** if it's only used for the top-right badge (AdminShell reads it through its `environment` prop passed from the page state). Pages that use `environment` for other purposes keep their own fetch.
3. **Replace the page title block** with `<PageHeader title="…" description="…" actions={…} />`. Actions go in the `actions` slot (e.g. Refresh button, filter selects).
4. **Replace hand-rolled stat cards** with `<StatCard label value previous subtext tone reverseTrendColors />`. The `tone` prop accepts `'neutral'|'danger'|'success'`. `previous` triggers the built-in trend arrow with correct semantic colouring.
5. **Replace error blocks** with Kumo `<Banner variant="danger">…</Banner>`. Never hand-roll an alert-style box.
6. **Replace loading placeholders** with Kumo `<Loader />` (or `<SkeletonLine>` where appropriate).
7. **Replace `window.alert()` calls** with the toast helper: `const toast = useToast(); toast.success('Saved', 'Changes persisted.')` (from `components/feedback/toast.js`). Exported methods: `success`, `error`, `warning`, `info`.
8. **Replace custom dropdowns** with Kumo `<Select items={[{value, label}]} value onValueChange />`.
9. **Replace the legacy date-range UI** with Kumo `<DatePicker mode="range" value={{from,to}} onValueChange />`. Do NOT use the exported `<DateRangePicker>` — it's deprecated in favour of `DatePicker mode="range"`.
10. **Replace tables** with Kumo `<Table>`. Header/body/row/cell styling uses the token classes above — don't re-import colour values.
11. **Delete every remaining `style={{...}}` block** on the page. Tailwind utility classes replace them. The grep `style={{` on a finished page should return zero hits.
12. **Nested `<Link><a>` pattern** — keep the `legacyBehavior` prop on any Link; don't fight it during migration. A later cleanup PR can modernize all Links in one pass once every page is Kumo-migrated.

## Structural patterns from the pilot

- **Section grouping**: reuse the small `<Section title="…">` wrapper inline in a page when you have 3+ headed groups. Don't abstract it into `components/` until 3 pages use it.
- **Stat grid breakpoints**: `grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3` is the default. Use 2-col for pages with ≤4 cards; 4-col (`xl:grid-cols-4`) only if the page has ≥8 cards.
- **Max width**: `mx-auto max-w-[1400px] px-6` on the content container, matching AdminShell's header. Keeps everything aligned to the same horizontal rhythm.

## Gotchas encountered

- **Tailwind v4 + Next 14 silently emits zero CSS.** If you ever rebase onto an older Next, the CSS disappears without an error. Next 15+ is mandatory. See `memory/kumo_stack_requirements.md`.
- **`@cloudflare/kumo/styles` resolves** via the package's `exports` map to `./dist/styles/kumo.css`. The standalone bundle at `@cloudflare/kumo/styles/standalone` is 104 KB and bakes in Tailwind — only use it if abandoning the Tailwind build.
- **Dev mode doesn't inject `<link rel="stylesheet">`** in the initial HTML — CSS is injected via JavaScript for HMR. Verify CSS against a `next build && next start` production server, not `next dev` + `curl`.
- **Pages Router `<Link>`** still works in Next 15 with `legacyBehavior`. Do not blindly run `npx @next/codemod` to modernize Links during migration — it's a separate concern and would conflate diffs.
