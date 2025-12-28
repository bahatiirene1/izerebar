/**
 * Animation Tokens
 * @implements ARCHITECTURE.md Section 8 - UI Layer
 *
 * Apple-grade animation presets using Motion (Framer Motion)
 */

import type { Variants, Transition } from 'motion/react';

// Duration constants
export const duration = {
  instant: 0,
  fast: 0.1,      // 100ms - button press
  normal: 0.25,   // 250ms - page transitions, modals
  slow: 0.4,      // 400ms - complex animations
  slower: 0.6,    // 600ms - emphasis
} as const;

// Easing presets (Apple-like smooth curves)
export const easing = {
  // Standard ease
  default: [0.25, 0.1, 0.25, 1],
  // Smooth entrance
  easeOut: [0, 0, 0.2, 1],
  // Smooth exit
  easeIn: [0.4, 0, 1, 1],
  // Spring-like
  spring: [0.34, 1.56, 0.64, 1],
  // iOS-like bounce
  bounce: [0.68, -0.55, 0.27, 1.55],
} as const;

// Standard transitions
export const transitions: Record<string, Transition> = {
  fast: { duration: duration.fast, ease: easing.default },
  normal: { duration: duration.normal, ease: easing.easeOut },
  slow: { duration: duration.slow, ease: easing.easeOut },
  spring: { type: 'spring', stiffness: 400, damping: 30 },
  springBounce: { type: 'spring', stiffness: 300, damping: 20 },
};

// Animation variants for common patterns
export const animations = {
  // Page transitions
  pageTransition: {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -10 },
  } satisfies Variants,

  // Fade in
  fadeIn: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  } satisfies Variants,

  // Slide up (for modals, sheets)
  slideUp: {
    initial: { opacity: 0, y: '100%' },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: '100%' },
  } satisfies Variants,

  // Scale (for modals)
  scale: {
    initial: { opacity: 0, scale: 0.95 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.95 },
  } satisfies Variants,

  // Slide from right (for toasts)
  slideRight: {
    initial: { opacity: 0, x: '100%' },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: '100%' },
  } satisfies Variants,

  // Button press
  buttonPress: {
    rest: { scale: 1 },
    pressed: { scale: 0.98 },
    hover: { scale: 1.02 },
  } satisfies Variants,

  // List item stagger
  listItem: {
    hidden: { opacity: 0, y: 10 },
    visible: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: { delay: i * 0.05 },
    }),
  } satisfies Variants,

  // Success checkmark
  successCheck: {
    hidden: { pathLength: 0, opacity: 0 },
    visible: {
      pathLength: 1,
      opacity: 1,
      transition: { duration: 0.4, ease: 'easeOut' },
    },
  } satisfies Variants,

  // Pulse (for indicators)
  pulse: {
    initial: { scale: 1 },
    animate: {
      scale: [1, 1.05, 1],
      transition: { duration: 1.5, repeat: Infinity },
    },
  } satisfies Variants,

  // Skeleton loading
  skeleton: {
    initial: { opacity: 0.5 },
    animate: {
      opacity: [0.5, 0.8, 0.5],
      transition: { duration: 1.5, repeat: Infinity },
    },
  } satisfies Variants,
} as const;

// Stagger children container
export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
};

// Stagger child
export const staggerChild: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
};

export type AnimationKey = keyof typeof animations;
