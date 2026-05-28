import { NavLink, Outlet, useNavigate } from 'react-router-dom';
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
        Main content. The mobile pb leaves room for the bottom tab bar (h-16) PLUS
        the home-indicator safe area, so nothing is ever covered by the tab bar.
      */}
      <main className="pb-[calc(5rem+var(--sa-bottom))] lg:pb-0 lg:pl-60">
        <div className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-8">
          <Outlet />
        </div>
      </main>

      {/*
        Mobile bottom tab bar — nested-glass structure. The outer <nav> ONLY
        carries `fixed inset-x-0 bottom-0 z-40 lg:hidden`; the inner wrapper
        carries the .app-bar glass + border + pb-safe + px-safe. This separates
        position: fixed from backdrop-filter to dodge the WebKit drift bug we
        hit in iOS standalone PWA where the nav landed at different Y on
        different routes. pb-safe still clears the home indicator because the
        outer <nav> sits flush at bottom: 0 and the inner wrapper's bottom
        padding lifts the touch row off the gesture area.
      */}
      <nav className="fixed inset-x-0 bottom-0 z-40 lg:hidden">
        <div className="app-bar border-t border-border/60 pb-safe px-safe">
          <div className="flex h-16 items-center justify-around">
            {mobileNav.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors active:scale-95',
                    isActive ? 'text-primary' : 'text-muted-foreground',
                  )
                }
              >
                <Icon className="h-5 w-5" strokeWidth={2} />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        </div>
      </nav>

      <InstallHint />
    </div>
  );
}
