import { useMemo } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Package,
  Plane,
  Users,
  Tags,
  Settings,
  BarChart3,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { cn } from '../lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { ThemeToggle } from './ThemeToggle';
import { InstallHint } from './InstallHint';

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/orders', label: 'Orders', icon: Package },
  { to: '/flyers', label: 'Flyers', icon: Plane },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/categories', label: 'Categories', icon: Tags },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

// Mobile bottom nav — surface the 5 most-used.
const mobileNav = nav.filter((n) => ['Dashboard', 'Orders', 'Flyers', 'Customers', 'Settings'].includes(n.label));

export function AppLayout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  /*
    Active tab index for the floating bottom nav's sliding highlight pill.
    Mirrors React Router's NavLink isActive logic:
      - end:true (Dashboard "/")  -> exact match only
      - end:false (everything else) -> exact OR child-path match
    Returns -1 when the user is on a non-mobile-nav route (e.g.
    /categories, /reports, deep order pages). The JSX renders the
    highlight pill only when activeIdx >= 0, so an off-tab route
    leaves the bar with no highlight, which is the right UX.
  */
  const activeIdx = useMemo(() => {
    return mobileNav.findIndex((n) =>
      n.end
        ? location.pathname === n.to
        : location.pathname === n.to || location.pathname.startsWith(`${n.to}/`),
    );
  }, [location.pathname]);

  return (
    <div className="min-h-svh bg-secondary/40">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-border bg-background lg:flex">
        <div className="flex h-12 items-center gap-2.5 border-b border-border px-5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Package className="h-3.5 w-3.5" strokeWidth={2.5} />
          </div>
          <div className="text-sm font-semibold tracking-tight">PP Logistics</div>
        </div>
        <nav className="flex-1 space-y-0.5 p-3">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )
              }
            >
              <Icon className="h-4 w-4" strokeWidth={2} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-1 border-t border-border p-3">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-2 text-left text-sm transition-colors hover:bg-secondary">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase">
                {user?.email?.slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1 truncate">
                <div className="truncate text-sm font-medium">{user?.displayName || user?.email?.split('@')[0]}</div>
                <div className="truncate text-xs text-muted-foreground">{user?.email}</div>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={async () => {
                  await signOut();
                  navigate('/login');
                }}
              >
                <LogOut className="h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ThemeToggle variant="menu" />
        </div>
      </aside>

      {/*
        Mobile app bar — nested-glass structure. The outer <header> ONLY carries
        positioning (sticky top-0 z-40 lg:hidden); the inner wrapper carries the
        .app-bar frosted-glass treatment + border + pt-safe + px-safe. Keeping
        backdrop-filter off the positioned element avoids a WebKit layer-
        attachment bug where `position: fixed`/`sticky` + `backdrop-filter` on
        the same element can drift between routes in iOS standalone PWA. The
        innermost row stays --appbar-h tall so every route renders at the
        identical height/Y. Status bar text colour is set by
        `apple-mobile-web-app-status-bar-style=black` in index.html.
      */}
      <header className="sticky top-0 z-40 lg:hidden">
        <div className="app-bar border-b border-border/60 pt-safe px-safe">
          <div className="flex items-center justify-between px-4 h-[var(--appbar-h)]">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Package className="h-3 w-3" strokeWidth={2.5} />
              </div>
              <div className="text-sm font-semibold tracking-tight">PP Logistics</div>
            </div>
            <div className="flex items-center gap-1.5">
              <ThemeToggle />
              <DropdownMenu>
                <DropdownMenuTrigger className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase">
                  {user?.email?.slice(0, 1)}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={async () => {
                      await signOut();
                      navigate('/login');
                    }}
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>

      {/*
        Main content. The mobile pb clears the floating Liquid Glass bottom
        nav (h-16 + 0.5rem gap above the safe-area inset + the safe-area
        inset itself) with an extra ~24px breathing room so the last row
        of content never sits flush under the pill.
      */}
      <main className="pb-[calc(6rem+var(--sa-bottom))] lg:pb-0 lg:pl-60">
        <div className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-8">
          <Outlet />
        </div>
      </main>

      {/*
        Mobile bottom tab bar — iOS 26 "Liquid Glass" floating pill.

        Layer responsibilities (mirrors the app-bar nested-glass pattern
        for the same WebKit reason — `position: fixed` and
        `backdrop-filter` on the SAME element causes drift between routes
        in iOS standalone PWA):
          outer <nav>      : positioning + safe-area gap (NOT glass)
                            pointer-events:none lets taps pass through
                            the gap between pill and screen edges
          inner pill <div> : .liquid-nav-pill glass + rounded-full +
                            relative for the sliding highlight's
                            absolute positioning
                            pointer-events:auto restores tap targets

        Inside the pill:
          - A sliding highlight pill (absolute-positioned, `left`
            transitions over 200ms with a spring-style easing) follows
            the active tab. Width = (pill-width − padding) / 5 so the
            five tabs share space equally.
          - Five NavLinks, each `.liquid-tab` (gets the press-shimmer
            pseudo-element) + `active:scale-[0.95]` for the iOS
            pressed-into-glass feel.
          - aria-current="page" on the active tab + aria-label per tab
            for screen readers; visible focus rings via focus-visible.
      */}
      <nav
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 lg:hidden"
        aria-label="Primary"
      >
        <div
          className="
            liquid-nav-pill pointer-events-auto relative
            mx-3 mb-[calc(0.5rem+var(--sa-bottom))]
            flex h-16 items-stretch
            rounded-full
            max-w-md sm:mx-auto
          "
        >
          {/* Sliding active-highlight pill — soft white-tinted darker
              pill behind the active tab. transitions `left` with a
              cubic-bezier spring curve so the move feels like the
              iOS Liquid Glass jelly bounce. */}
          {activeIdx >= 0 && (
            <div
              aria-hidden="true"
              className="
                pointer-events-none absolute top-1.5 bottom-1.5
                rounded-full
                bg-white/[0.10]
                transition-[left]
              "
              style={{
                width: 'calc((100% - 0.75rem) / 5)',
                left: `calc(0.375rem + ${activeIdx} * (100% - 0.75rem) / 5)`,
                transitionDuration: '220ms',
                transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            />
          )}
          {mobileNav.map(({ to, label, icon: Icon, end }, i) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              aria-label={label}
              aria-current={i === activeIdx ? 'page' : undefined}
              className={({ isActive }) =>
                cn(
                  'liquid-tab relative z-10 flex flex-1 flex-col items-center justify-center gap-0.5 rounded-full py-1.5 text-[10px] font-medium',
                  'transition-transform duration-100',
                  // Inline a snappy spring on press so the icon+label
                  // dip into the glass on tap.
                  'active:scale-[0.95]',
                  // Keyboard accessibility — visible focus ring.
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-0',
                  isActive ? 'text-primary' : 'text-white/85',
                )
              }
            >
              <Icon className="h-5 w-5" strokeWidth={2} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      <InstallHint />
    </div>
  );
}
