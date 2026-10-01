import { useRouter } from 'next/router';
import NextLink from 'next/link';
import { useEffect, useState } from 'react';
import {
  Receipt,
  Users,
  ChartLineUp,
  ShoppingCartSimple,
  Ticket,
  Wallet,
  Envelope,
  PaperPlaneTilt,
  TrayArrowDown,
  MagnifyingGlass,
  Truck,
  Gift,
  Sparkle,
  ForkKnife,
  Prohibit,
  SignOut,
  List,
  CaretRight,
  CaretLeft,
  SidebarSimple,
} from '@phosphor-icons/react';

// Nav grouped into workflow sections:
//   Ops          — daily order/dispatch handling, split by mode (Food / Grocery)
//   Reports      — read-only analytics & customer insight (shared across modes)
//   Account      — account-level tools that apply to any order type
//   Marketing    — outreach & promotion tools
//
// A section can either have `items` directly OR a `subgroups` array
// (each subgroup has its own label + items). Ops uses subgroups so a
// dispatcher sees one mode's queue at a time without losing the top-level
// grouping. See docs/grocery-admin-plan.html §2 for the rationale.
const NAV_SECTIONS = [
  {
    label: 'Ops',
    subgroups: [
      {
        label: 'Food',
        items: [
          { href: '/',                label: 'Dispatch',        icon: Truck },
          { href: '/orders',          label: 'Orders',          icon: Receipt },
          { href: '/inbox',           label: 'Inbox',           icon: TrayArrowDown },
          { href: '/abandoned-carts', label: 'Abandoned Carts', icon: ShoppingCartSimple },
        ],
      },
      {
        label: 'Grocery',
        items: [
          { href: '/grocery/orders',   label: 'Orders',   icon: Receipt },
          { href: '/grocery/dispatch', label: 'Dispatch', icon: Truck },
        ],
      },
    ],
  },
  {
    label: 'Reports',
    items: [
      { href: '/analytics',   label: 'Analytics',   icon: ChartLineUp },
      { href: '/customers',   label: 'Customers',   icon: Users },
      { href: '/attribution', label: 'Attribution', icon: MagnifyingGlass },
      { href: '/referral',    label: 'Referrals',   icon: Gift },
      { href: '/upsell',      label: 'Upsell',      icon: Sparkle },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/store-credits', label: 'Store Credits', icon: Wallet },
    ],
  },
  {
    label: 'Marketing',
    items: [
      { href: '/email-campaigns',       label: 'Email Campaigns',  icon: PaperPlaneTilt },
      { href: '/email-templates',       label: 'Email Templates',  icon: Envelope },
      { href: '/traveler-dinner-emails', label: 'Traveler Dinner', icon: ForkKnife },
      { href: '/unsubscribes',          label: 'Unsubscribes',     icon: Prohibit },
      { href: '/promo-codes',           label: 'Promo Codes',      icon: Ticket },
    ],
  },
];

// Walk all items across sections and subgroups. Used for active-item
// lookup and the mobile breadcrumb.
function flattenNavItems(sections) {
  const out = [];
  for (const s of sections) {
    if (s.items) out.push(...s.items);
    if (s.subgroups) for (const g of s.subgroups) out.push(...g.items);
  }
  return out;
}
const NAV_ITEMS = flattenNavItems(NAV_SECTIONS);

const COLLAPSE_STORAGE_KEY = 'admin-sidebar-collapsed';

function NavItemList({ items, activeHref, isCollapsed, onItemClick }) {
  return (
    <ul className="space-y-px">
      {items.map((item) => (
        <li key={item.href} className="relative">
          <NavButton
            href={item.href}
            label={item.label}
            Icon={item.icon}
            isActive={item.href === activeHref}
            collapsed={isCollapsed}
            onClick={onItemClick}
          />
        </li>
      ))}
    </ul>
  );
}

function NavButton({ href, label, Icon, isActive, collapsed, onClick }) {
  const base = 'relative flex items-center rounded-[6px] text-[13px] transition-colors';
  const layout = collapsed
    ? 'h-9 w-9 justify-center mx-auto'
    : 'w-full gap-2.5 pl-3 pr-2 py-1.5';
  const tone = isActive
    ? 'text-ink-900 font-medium bg-ink-50'
    : 'text-ink-600 hover:text-ink-900 hover:bg-ink-50';
  return (
    <NextLink
      href={href}
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`${base} ${layout} ${tone}`}
    >
      {isActive ? (
        <span
          aria-hidden
          className="absolute left-0 top-1.5 bottom-1.5 w-[2px] bg-accent rounded-r-sm"
        />
      ) : null}
      <Icon
        className={
          'h-[15px] w-[15px] shrink-0 ' + (isActive ? 'text-ink-900' : 'text-ink-400')
        }
        weight="regular"
      />
      {!collapsed ? <span>{label}</span> : null}
    </NextLink>
  );
}

export function AdminShell({ children, environment }) {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Load collapsed state from localStorage on mount (client-only to avoid SSR mismatch).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (stored === '1') setCollapsed(true);
    } catch {}
    setMounted(true);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0');
      } catch {}
      return next;
    });
  };

  const activeItem =
    NAV_ITEMS.find((item) =>
      item.href === '/' ? router.pathname === '/' : router.pathname.startsWith(item.href),
    ) ?? NAV_ITEMS[0];

  // Find the subgroup label (e.g., "Grocery") for the active item, if any.
  // Used in the breadcrumb so /grocery/orders reads as "Dashboard › Grocery › Orders"
  // and not just "Dashboard › Orders" (ambiguous with food).
  const activeSubgroupLabel = (() => {
    for (const s of NAV_SECTIONS) {
      if (!s.subgroups) continue;
      for (const g of s.subgroups) {
        if (g.items.some((i) => i.href === activeItem.href)) return g.label;
      }
    }
    return null;
  })();

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  // Avoid applying the collapsed class on the very first server-rendered frame
  // to prevent layout-shift flash. `mounted` flips true after hydration.
  const isCollapsed = mounted && collapsed;
  const asideWidth = isCollapsed ? 'w-14' : 'w-60';
  const mainOffset = isCollapsed ? 'lg:pl-14' : 'lg:pl-60';

  return (
    <div className="min-h-screen bg-ink-0">
      {/* Mobile backdrop */}
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      {/* Sidebar */}
      <aside
        className={
          `fixed top-0 left-0 z-50 h-full ${asideWidth} bg-ink-0 border-r border-ink-100 flex flex-col transition-[width,transform] duration-200 ease-out ` +
          (mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0')
        }
      >
        <div
          className={
            'h-14 flex items-center gap-1.5 pt-5 pb-3 ' +
            (isCollapsed ? 'justify-center px-2' : 'px-5')
          }
        >
          {!isCollapsed ? (
            <>
              <span className="text-[13px] font-semibold tracking-tight text-ink-900">
                FoodtoIndia
              </span>
              <span className="text-[10px] font-medium uppercase tracking-micro text-ink-400">
                Admin
              </span>
            </>
          ) : (
            <span className="text-[13px] font-semibold tracking-tight text-ink-900">F</span>
          )}
        </div>

        <nav className={'flex-1 overflow-y-auto ' + (isCollapsed ? 'px-1 pt-2' : 'px-2 pt-2')}>
          {NAV_SECTIONS.map((section, si) => (
            <div key={section.label} className={si > 0 ? 'mt-4' : ''}>
              {/* Section header — a small uppercase label when expanded,
                  a thin divider when collapsed (label wouldn't fit). */}
              {!isCollapsed ? (
                <div className="px-3 pb-1 text-[10px] font-medium uppercase tracking-micro text-ink-400">
                  {section.label}
                </div>
              ) : si > 0 ? (
                <div className="mx-2 mb-2 border-t border-ink-100" />
              ) : null}
              {section.items ? (
                <NavItemList
                  items={section.items}
                  activeHref={activeItem.href}
                  isCollapsed={isCollapsed}
                  onItemClick={() => setMobileOpen(false)}
                />
              ) : null}
              {section.subgroups
                ? section.subgroups.map((group, gi) => (
                    <div key={group.label} className={gi > 0 ? 'mt-2' : ''}>
                      {!isCollapsed ? (
                        <div className="px-4 pt-1 pb-0.5 text-[10px] font-medium uppercase tracking-micro text-ink-300">
                          {group.label}
                        </div>
                      ) : gi > 0 ? (
                        <div className="mx-3 my-1.5 border-t border-ink-100" />
                      ) : null}
                      <NavItemList
                        items={group.items}
                        activeHref={activeItem.href}
                        isCollapsed={isCollapsed}
                        onItemClick={() => setMobileOpen(false)}
                      />
                    </div>
                  ))
                : null}
            </div>
          ))}
        </nav>

        <div
          className={
            'border-t border-ink-100 ' + (isCollapsed ? 'px-1 py-2' : 'px-2 py-3')
          }
        >
          <button
            type="button"
            onClick={toggleCollapsed}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={
              'hidden items-center rounded-[6px] text-[13px] text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-900 lg:flex ' +
              (isCollapsed
                ? 'h-9 w-9 justify-center mx-auto'
                : 'w-full gap-2.5 pl-3 pr-2 py-1.5')
            }
          >
            {isCollapsed ? (
              <CaretRight className="h-[14px] w-[14px] shrink-0" weight="regular" />
            ) : (
              <SidebarSimple className="h-[15px] w-[15px] shrink-0" weight="regular" />
            )}
            {!isCollapsed ? <span>Collapse</span> : null}
          </button>
          <button
            type="button"
            onClick={handleLogout}
            title={isCollapsed ? 'Log out' : undefined}
            className={
              'mt-1 flex items-center rounded-[6px] text-[13px] text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-900 ' +
              (isCollapsed
                ? 'h-9 w-9 justify-center mx-auto'
                : 'w-full gap-2.5 pl-3 pr-2 py-1.5')
            }
          >
            <SignOut className="h-[15px] w-[15px] shrink-0" weight="regular" />
            {!isCollapsed ? <span>Log out</span> : null}
          </button>
        </div>
      </aside>

      <div className={mainOffset}>
        {/* Top header bar — breadcrumb + environment badge */}
        <header className="sticky top-0 z-30 h-14 border-b border-ink-100 bg-ink-0">
          <div className="flex h-full items-center justify-between gap-3 px-4 sm:px-8 lg:px-10">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileOpen((v) => !v)}
                className="-ml-1.5 rounded-[6px] p-1.5 text-ink-500 hover:bg-ink-50 hover:text-ink-900 transition-colors lg:hidden"
                aria-label="Toggle menu"
              >
                <List className="h-5 w-5" weight="regular" />
              </button>
              {router.pathname === '/' ? (
                <h2 className="text-[15px] font-semibold tracking-tight text-ink-900">
                  {activeItem.label}
                </h2>
              ) : (
                <nav className="flex items-center gap-1.5 text-[13px]">
                  <NextLink
                    href="/"
                    className="text-ink-500 transition-colors hover:text-ink-900"
                  >
                    Dashboard
                  </NextLink>
                  <CaretRight className="h-3.5 w-3.5 text-ink-300" weight="regular" />
                  {activeSubgroupLabel ? (
                    <>
                      <span className="text-ink-500">{activeSubgroupLabel}</span>
                      <CaretRight className="h-3.5 w-3.5 text-ink-300" weight="regular" />
                    </>
                  ) : null}
                  <span className="font-medium text-ink-900">{activeItem.label}</span>
                </nav>
              )}
            </div>
            {environment ? (
              <span
                className={
                  'rounded-[4px] px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-micro ' +
                  (environment === 'production'
                    ? 'bg-danger-weak text-danger'
                    : 'bg-success-weak text-success')
                }
              >
                {environment === 'production' ? 'Prod' : 'Dev'}
              </span>
            ) : null}
          </div>
        </header>

        <main className="mx-auto max-w-[1400px] px-4 py-8 sm:px-8 lg:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}
