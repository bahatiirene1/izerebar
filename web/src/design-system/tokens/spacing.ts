/**
 * Spacing Tokens
 * @implements ARCHITECTURE.md Section 8 - UI Layer
 *
 * Consistent spacing scale for layout and components
 */

export const spacing = {
  0: '0',
  px: '1px',
  0.5: '0.125rem',  // 2px
  1: '0.25rem',     // 4px
  1.5: '0.375rem',  // 6px
  2: '0.5rem',      // 8px
  2.5: '0.625rem',  // 10px
  3: '0.75rem',     // 12px
  3.5: '0.875rem',  // 14px
  4: '1rem',        // 16px
  5: '1.25rem',     // 20px
  6: '1.5rem',      // 24px
  7: '1.75rem',     // 28px
  8: '2rem',        // 32px
  9: '2.25rem',     // 36px
  10: '2.5rem',     // 40px
  11: '2.75rem',    // 44px
  12: '3rem',       // 48px
  14: '3.5rem',     // 56px
  16: '4rem',       // 64px
  20: '5rem',       // 80px
  24: '6rem',       // 96px
  28: '7rem',       // 112px
  32: '8rem',       // 128px
  36: '9rem',       // 144px
  40: '10rem',      // 160px
  44: '11rem',      // 176px
  48: '12rem',      // 192px
  52: '13rem',      // 208px
  56: '14rem',      // 224px
  60: '15rem',      // 240px
  64: '16rem',      // 256px
  72: '18rem',      // 288px
  80: '20rem',      // 320px
  96: '24rem',      // 384px
} as const;

export const borderRadius = {
  none: '0',
  sm: '0.125rem',   // 2px
  default: '0.25rem', // 4px
  md: '0.375rem',   // 6px
  lg: '0.5rem',     // 8px
  xl: '0.75rem',    // 12px
  '2xl': '1rem',    // 16px
  '3xl': '1.5rem',  // 24px
  full: '9999px',
} as const;

// Common layout presets
export const layoutPresets = {
  // Container max widths
  containerSm: 'max-w-screen-sm',   // 640px
  containerMd: 'max-w-screen-md',   // 768px
  containerLg: 'max-w-screen-lg',   // 1024px
  containerXl: 'max-w-screen-xl',   // 1280px
  container2xl: 'max-w-screen-2xl', // 1536px

  // Stack layouts (vertical)
  stackSm: 'flex flex-col gap-2',
  stackMd: 'flex flex-col gap-4',
  stackLg: 'flex flex-col gap-6',

  // Row layouts (horizontal)
  rowSm: 'flex flex-row gap-2',
  rowMd: 'flex flex-row gap-4',
  rowLg: 'flex flex-row gap-6',

  // Grid layouts
  grid2: 'grid grid-cols-2 gap-4',
  grid3: 'grid grid-cols-3 gap-4',
  grid4: 'grid grid-cols-4 gap-4',

  // Padding presets
  paddingSm: 'p-2',
  paddingMd: 'p-4',
  paddingLg: 'p-6',
  paddingXl: 'p-8',

  // Card padding
  cardPadding: 'p-4 sm:p-6',
  sectionPadding: 'py-8 px-4 sm:px-6 lg:px-8',
} as const;

export type SpacingKey = keyof typeof spacing;
export type BorderRadiusKey = keyof typeof borderRadius;
