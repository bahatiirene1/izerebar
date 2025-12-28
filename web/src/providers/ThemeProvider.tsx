/**
 * Theme Provider
 * @implements ARCHITECTURE.md Section 8 - UI Layer
 *
 * Provides theme context with system detection and toggle functionality
 */

import { useEffect } from 'react';
import { useThemeStore, type Theme, type ResolvedTheme } from '@/lib/store/theme';

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
}

/**
 * Theme Provider Component
 * Wraps the app and initializes theme on mount
 */
export function ThemeProvider({
  children,
  defaultTheme = 'system',
}: ThemeProviderProps) {
  const { setTheme } = useThemeStore();

  useEffect(() => {
    // If no stored theme, use default
    if (!localStorage.getItem('izerebar-theme')) {
      setTheme(defaultTheme);
    }
  }, [defaultTheme, setTheme]);

  return <>{children}</>;
}

/**
 * Hook to use theme
 */
export function useTheme() {
  const { theme, resolvedTheme, setTheme } = useThemeStore();

  const toggleTheme = () => {
    if (resolvedTheme === 'dark') {
      setTheme('light');
    } else {
      setTheme('dark');
    }
  };

  const cycleTheme = () => {
    const themes: Theme[] = ['light', 'dark', 'system'];
    const currentIndex = themes.indexOf(theme);
    const nextIndex = (currentIndex + 1) % themes.length;
    setTheme(themes[nextIndex]);
  };

  return {
    theme,
    resolvedTheme,
    setTheme,
    toggleTheme,
    cycleTheme,
    isDark: resolvedTheme === 'dark',
    isLight: resolvedTheme === 'light',
    isSystem: theme === 'system',
  };
}

export type { Theme, ResolvedTheme };
