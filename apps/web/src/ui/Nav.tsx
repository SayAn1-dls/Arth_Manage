import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { cn } from './cn.js';

export interface NavItemProps {
  to: string;
  icon?: ReactNode;
  children: ReactNode;
  end?: boolean;
}

/** Active state is an Ember rule plus bold weight: never colour alone. */
export function NavItem({ to, icon, children, end }: NavItemProps) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex min-h-11 items-center gap-3 border-l-4 px-4 py-2 text-base text-ink no-underline hover:bg-blush',
          isActive ? 'border-ember bg-blush font-bold' : 'border-transparent font-medium',
        )
      }
    >
      {icon}
      {children}
    </NavLink>
  );
}

export function SideNav({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav aria-label={label} className="flex flex-col gap-1">
      {children}
    </nav>
  );
}
