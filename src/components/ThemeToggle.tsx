import { Sun, Moon, Monitor, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from './ui/dropdown-menu';
import { useTheme, type ThemePref } from '../lib/theme';
import { cn } from '../lib/utils';

const OPTIONS: Array<{ value: ThemePref; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'auto', label: 'System', icon: Monitor },
];

/**
 * Theme toggle. Renders one of three icons based on the user's preference:
 *  - light → Sun
 *  - dark  → Moon
 *  - auto  → Monitor (system)
 *
 * Use `variant="standalone"` for a bordered icon-button (top-right of mobile
 * header) or omit for the menu-row variant used inside the user dropdown.
 */
export function ThemeToggle({ variant = 'standalone' }: { variant?: 'standalone' | 'menu' }) {
  const pref = useTheme((s) => s.pref);
  const setPref = useTheme((s) => s.setPref);
  const Active = OPTIONS.find((o) => o.value === pref)?.icon ?? Monitor;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          variant === 'standalone'
            ? 'inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground'
            : 'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary',
        )}
        aria-label="Theme"
      >
        <Active className="h-4 w-4" strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem
            key={value}
            onSelect={(e) => {
              e.preventDefault();
              setPref(value);
            }}
            className="justify-between"
          >
            <span className="inline-flex items-center gap-2">
              <Icon className="h-4 w-4" />
              {label}
            </span>
            {pref === value && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
