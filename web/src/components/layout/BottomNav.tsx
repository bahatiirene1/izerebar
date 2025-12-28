/**
 * BottomNav Component
 * @implements ARCHITECTURE.md Section 8 - UI Layer
 *
 * Mobile navigation bar with role-based items
 */

import { NavLink, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  LayoutDashboard,
  ShoppingCart,
  Boxes,
  BarChart3,
  Menu,
  type LucideIcon,
} from 'lucide-react';
import { useUserRole, type UserRole } from '@/lib/store/auth';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  roles: UserRole[];
}

// Limited items for mobile - most important actions
const navItems: NavItem[] = [
  {
    label: 'Home',
    href: '/',
    icon: LayoutDashboard,
    roles: ['owner', 'manager', 'bartender', 'server'],
  },
  {
    label: 'Sales',
    href: '/sales',
    icon: ShoppingCart,
    roles: ['owner', 'manager', 'bartender', 'server'],
  },
  {
    label: 'Stock',
    href: '/stock',
    icon: Boxes,
    roles: ['owner', 'manager', 'bartender', 'server'],
  },
  {
    label: 'Reports',
    href: '/reports',
    icon: BarChart3,
    roles: ['owner', 'manager'],
  },
  {
    label: 'More',
    href: '/menu',
    icon: Menu,
    roles: ['owner', 'manager', 'bartender', 'server'],
  },
];

export function BottomNav() {
  const userRole = useUserRole();
  const location = useLocation();

  // Filter items based on user role, limit to 5
  const visibleItems = navItems
    .filter((item) => userRole && item.roles.includes(userRole))
    .slice(0, 5);

  return (
    <nav
      className={cn(
        'fixed bottom-0 left-0 right-0 z-40',
        'h-16 px-2',
        'bg-[var(--bg-secondary)]/80 backdrop-blur-xl',
        'border-t border-[var(--border-default)]',
        'safe-area-inset-bottom'
      )}
    >
      <ul className="h-full flex items-center justify-around">
        {visibleItems.map((item) => {
          const isActive =
            location.pathname === item.href ||
            (item.href !== '/' && location.pathname.startsWith(item.href));

          return (
            <li key={item.href}>
              <NavLink
                to={item.href}
                className="relative flex flex-col items-center gap-0.5 px-3 py-1"
              >
                {/* Active indicator */}
                {isActive && (
                  <motion.div
                    layoutId="bottomnav-active"
                    className="absolute -top-2 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[var(--color-brand-primary)]"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}

                <item.icon
                  size={22}
                  className={cn(
                    'transition-colors duration-150',
                    isActive
                      ? 'text-[var(--color-brand-primary)]'
                      : 'text-[var(--text-tertiary)]'
                  )}
                />
                <span
                  className={cn(
                    'text-[10px] font-medium',
                    'transition-colors duration-150',
                    isActive
                      ? 'text-[var(--color-brand-primary)]'
                      : 'text-[var(--text-tertiary)]'
                  )}
                >
                  {item.label}
                </span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
