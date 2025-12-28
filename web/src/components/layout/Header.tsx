/**
 * Header Component
 * @implements ARCHITECTURE.md Section 8 - UI Layer
 *
 * Top navigation bar with user info and theme toggle
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bell,
  Sun,
  Moon,
  Monitor,
  ChevronDown,
  LogOut,
  Settings,
} from 'lucide-react';
import { useTheme } from '@/providers/ThemeProvider';
import { useAuthStore } from '@/lib/store/auth';
import { cn } from '@/lib/utils';

export function Header() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { user, bar, logout } = useAuthStore();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showThemeMenu, setShowThemeMenu] = useState(false);

  const ThemeIcon = resolvedTheme === 'dark' ? Moon : Sun;

  return (
    <header
      className={cn(
        'fixed top-0 left-0 right-0 z-40 h-16',
        'bg-[var(--bg-secondary)]/80 backdrop-blur-xl',
        'border-b border-[var(--border-default)]'
      )}
    >
      <div className="h-full px-4 flex items-center justify-between">
        {/* Left: Logo & Bar Name */}
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="flex items-center gap-2 text-[var(--text-primary)] font-semibold"
          >
            <div className="w-8 h-8 rounded-lg bg-[var(--color-brand-primary)] flex items-center justify-center text-white font-bold">
              I
            </div>
            <span className="hidden sm:inline">Izerebar</span>
          </Link>

          {bar && (
            <>
              <span className="text-[var(--border-default)]">/</span>
              <span className="text-[var(--text-secondary)] text-sm truncate max-w-[150px]">
                {bar.name}
              </span>
            </>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {/* Theme toggle */}
          <div className="relative">
            <button
              onClick={() => setShowThemeMenu(!showThemeMenu)}
              className={cn(
                'p-2 rounded-lg',
                'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                'hover:bg-[var(--bg-tertiary)]',
                'transition-colors duration-150'
              )}
              aria-label="Change theme"
            >
              <ThemeIcon size={20} />
            </button>

            <AnimatePresence>
              {showThemeMenu && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowThemeMenu(false)}
                  />
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -10 }}
                    transition={{ duration: 0.15 }}
                    className={cn(
                      'absolute right-0 top-full mt-2 z-20',
                      'w-36 py-1 rounded-xl',
                      'bg-[var(--bg-secondary)] border border-[var(--border-default)]',
                      'shadow-lg'
                    )}
                  >
                    {[
                      { value: 'light', label: 'Light', icon: Sun },
                      { value: 'dark', label: 'Dark', icon: Moon },
                      { value: 'system', label: 'System', icon: Monitor },
                    ].map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        onClick={() => {
                          setTheme(value as 'light' | 'dark' | 'system');
                          setShowThemeMenu(false);
                        }}
                        className={cn(
                          'w-full px-3 py-2 flex items-center gap-2 text-sm',
                          'hover:bg-[var(--bg-tertiary)]',
                          theme === value
                            ? 'text-[var(--color-brand-primary)]'
                            : 'text-[var(--text-secondary)]'
                        )}
                      >
                        <Icon size={16} />
                        {label}
                      </button>
                    ))}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

          {/* Notifications */}
          <button
            className={cn(
              'p-2 rounded-lg',
              'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
              'hover:bg-[var(--bg-tertiary)]',
              'transition-colors duration-150'
            )}
            aria-label="Notifications"
          >
            <Bell size={20} />
          </button>

          {/* User menu */}
          {user && (
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className={cn(
                  'flex items-center gap-2 p-1.5 pl-3 rounded-lg',
                  'hover:bg-[var(--bg-tertiary)]',
                  'transition-colors duration-150'
                )}
              >
                <span className="text-sm font-medium text-[var(--text-primary)] hidden sm:inline">
                  {user.name}
                </span>
                <div className="w-8 h-8 rounded-full bg-[var(--color-brand-primary)] flex items-center justify-center text-white text-sm font-medium">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <ChevronDown
                  size={16}
                  className="text-[var(--text-tertiary)] hidden sm:block"
                />
              </button>

              <AnimatePresence>
                {showUserMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowUserMenu(false)}
                    />
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: -10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: -10 }}
                      transition={{ duration: 0.15 }}
                      className={cn(
                        'absolute right-0 top-full mt-2 z-20',
                        'w-48 py-1 rounded-xl',
                        'bg-[var(--bg-secondary)] border border-[var(--border-default)]',
                        'shadow-lg'
                      )}
                    >
                      <div className="px-3 py-2 border-b border-[var(--border-default)]">
                        <p className="text-sm font-medium text-[var(--text-primary)]">
                          {user.name}
                        </p>
                        <p className="text-xs text-[var(--text-tertiary)] capitalize">
                          {user.role}
                        </p>
                      </div>

                      <Link
                        to="/settings"
                        onClick={() => setShowUserMenu(false)}
                        className={cn(
                          'w-full px-3 py-2 flex items-center gap-2 text-sm',
                          'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                          'hover:bg-[var(--bg-tertiary)]'
                        )}
                      >
                        <Settings size={16} />
                        Settings
                      </Link>

                      <button
                        onClick={() => {
                          logout();
                          setShowUserMenu(false);
                        }}
                        className={cn(
                          'w-full px-3 py-2 flex items-center gap-2 text-sm',
                          'text-red-500 hover:bg-red-500/10'
                        )}
                      >
                        <LogOut size={16} />
                        Logout
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
