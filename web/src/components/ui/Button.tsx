/**
 * Button Component
 * @implements ARCHITECTURE.md Section 8 - UI Layer
 *
 * Primary interactive element with Apple-grade animations
 */

import { forwardRef, type ReactNode } from 'react';
import { motion, type HTMLMotionProps } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ButtonProps
  extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  children?: ReactNode;
}

const variants = {
  primary:
    'bg-[var(--color-brand-primary)] hover:bg-[var(--color-brand-hover)] text-white',
  secondary:
    'bg-[var(--bg-tertiary)] hover:bg-[var(--border-default)] text-[var(--text-primary)] border border-[var(--border-default)]',
  ghost:
    'bg-transparent hover:bg-[var(--bg-tertiary)] text-[var(--text-primary)]',
  danger:
    'bg-red-500 hover:bg-red-600 text-white',
  success:
    'bg-green-500 hover:bg-green-600 text-white',
};

const sizes = {
  sm: 'h-8 px-3 text-sm gap-1.5 rounded-md',
  md: 'h-10 px-4 text-base gap-2 rounded-lg',
  lg: 'h-12 px-6 text-lg gap-2.5 rounded-xl',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      children,
      disabled,
      className,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || isLoading;

    return (
      <motion.button
        ref={ref}
        className={cn(
          // Base styles
          'inline-flex items-center justify-center font-medium',
          'transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          // Variant and size
          variants[variant],
          sizes[size],
          className
        )}
        disabled={isDisabled}
        whileTap={{ scale: isDisabled ? 1 : 0.98 }}
        whileHover={{ scale: isDisabled ? 1 : 1.01 }}
        transition={{ duration: 0.1 }}
        {...props}
      >
        {isLoading ? (
          <Loader2 className="animate-spin" size={size === 'sm' ? 14 : size === 'lg' ? 20 : 16} />
        ) : (
          leftIcon
        )}
        {children}
        {!isLoading && rightIcon}
      </motion.button>
    );
  }
);

Button.displayName = 'Button';
