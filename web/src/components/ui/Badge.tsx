/**
 * Badge Component
 * @implements ARCHITECTURE.md Section 8 - UI Layer
 *
 * Status badges for sales and other entities
 */

import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'pending' | 'collected' | 'confirmed' | 'reversed' | 'open' | 'closed';
  size?: 'sm' | 'md';
}

const variants = {
  default: 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]',
  pending: 'bg-amber-500/15 text-amber-500',
  collected: 'bg-blue-500/15 text-blue-500',
  confirmed: 'bg-green-500/15 text-green-500',
  reversed: 'bg-red-500/15 text-red-500',
  open: 'bg-green-500/15 text-green-500',
  closed: 'bg-gray-500/15 text-gray-500',
};

const sizes = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-sm',
};

export function Badge({
  variant = 'default',
  size = 'sm',
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center font-medium rounded-full',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
