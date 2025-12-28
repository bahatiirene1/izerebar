/**
 * Color Tokens
 * @implements ARCHITECTURE.md Section 8 - UI Layer
 *
 * Minimal, professional color palette for both light and dark themes
 */

export const colors = {
  dark: {
    background: {
      primary: '#0A0A0B',
      secondary: '#141416',
      tertiary: '#1C1C1F',
    },
    text: {
      primary: '#FFFFFF',
      secondary: '#A1A1AA',
      tertiary: '#71717A',
    },
    brand: {
      primary: '#3B82F6',
      hover: '#2563EB',
    },
    status: {
      pending: '#F59E0B',
      collected: '#3B82F6',
      confirmed: '#22C55E',
      reversed: '#EF4444',
    },
    border: {
      default: '#27272A',
      hover: '#3F3F46',
    },
  },
  light: {
    background: {
      primary: '#FFFFFF',
      secondary: '#F9FAFB',
      tertiary: '#F3F4F6',
    },
    text: {
      primary: '#111827',
      secondary: '#4B5563',
      tertiary: '#9CA3AF',
    },
    brand: {
      primary: '#2563EB',
      hover: '#1D4ED8',
    },
    status: {
      pending: '#D97706',
      collected: '#2563EB',
      confirmed: '#16A34A',
      reversed: '#DC2626',
    },
    border: {
      default: '#E5E7EB',
      hover: '#D1D5DB',
    },
  },
} as const;

// Status colors (shared between themes with slight adjustments)
export const statusColors = {
  pending: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-500',
    border: 'border-amber-500/20',
  },
  collected: {
    bg: 'bg-blue-500/10',
    text: 'text-blue-500',
    border: 'border-blue-500/20',
  },
  confirmed: {
    bg: 'bg-green-500/10',
    text: 'text-green-500',
    border: 'border-green-500/20',
  },
  reversed: {
    bg: 'bg-red-500/10',
    text: 'text-red-500',
    border: 'border-red-500/20',
  },
} as const;

export type StatusType = keyof typeof statusColors;
