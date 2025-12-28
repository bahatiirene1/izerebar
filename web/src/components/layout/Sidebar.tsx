/**
 * Sidebar Component
 * @implements ARCHITECTURE.md Section 8 - UI Layer
 *
 * Desktop navigation with role-based menu items
 */

import { NavLink, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  LayoutDashboard,
  Calendar,
  ShoppingCart,
  Package,
  Users,
  BarChart3,
  Settings,
  Boxes,
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

const navItems: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/',
    icon: LayoutDashboard,
    roles: ['owner', 'manager', 'bartender', 'server'],
  },
  {
    label: 'Day & Shift',
    href: '/day-shift',
    icon: Calendar,
    roles: ['owner', 'manager'],
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
    label: 'Products',
    href: '/products',
    icon: Package,
    roles: ['owner', 'manager'],
  },
  {
    label: 'Staff',
    href: '/staff',
    icon: Users,
    roles: ['owner', 'manager'],
  },
  {
    label: 'Reports',
    href: '/reports',
    icon: BarChart3,
    roles: ['owner', 'manager'],
  },
  {
    label: 'Settings',
    href: '/settings',
    icon: Settings,
    roles: ['owner'],
  },
];

export function Sidebar() {
  const userRole = useUserRole();
  const location = useLocation();

  // Filter items based on user role
  const visibleItems = navItems.filter(
    (item) => userRole && item.roles.includes(userRole)
  );

  return (
    <nav
      className={cn(
        'fixed left-0 top-16 bottom-0 z-30',
        'w-64 py-4 px-3',
        'bg-[var(--bg-secondary)] border-r border-[var(--border-default)]',
        'overflow-y-auto'
      )}
    >
      <ul className="space-y-1">
        {visibleItems.map((item) => {
          const isActive =
            location.pathname === item.href ||
            (item.href !== '/' && location.pathname.startsWith(item.href));

          return (
            <li key={item.href}>
              <NavLink
                to={item.href}
                className={cn(
                  'relative flex items-center gap-3 px-3 py-2.5 rounded-lg',
                  'text-sm font-medium',
                  'transition-colors duration-150',
                  isActive
                    ? 'text-[var(--color-brand-primary)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                )}
              >
                {/* Active indicator */}
                {isActive && (
                  <motion.div
                    layoutId="sidebar-active"
                    className="absolute inset-0 bg-[var(--color-brand-primary)]/10 rounded-lg"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}

                <item.icon size={20} className="relative z-10" />
                <span className="relative z-10">{item.label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>

      {/* Version info */}
      <div className="absolute bottom-4 left-3 right-3">
        <p className="text-xs text-[var(--text-tertiary)] text-center">
          Izerebar v1.0.0
        </p>
      </div>
    </nav>
  );
}
