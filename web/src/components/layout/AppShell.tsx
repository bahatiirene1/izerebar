/**
 * AppShell Layout Component
 * @implements ARCHITECTURE.md Section 8 - UI Layer
 *
 * Main layout wrapper with responsive navigation
 */

import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';

export interface AppShellProps {
  children: ReactNode;
  hideNav?: boolean;
}

export function AppShell({ children, hideNav = false }: AppShellProps) {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      {/* Header - always visible */}
      <Header />

      <div className="flex">
        {/* Sidebar - desktop only */}
        {!hideNav && (
          <aside className="hidden lg:block">
            <Sidebar />
          </aside>
        )}

        {/* Main content */}
        <main
          className={cn(
            'flex-1 min-h-[calc(100vh-4rem)]',
            'pt-16', // Header height
            !hideNav && 'pb-16 lg:pb-0', // Bottom nav on mobile
            !hideNav && 'lg:pl-64' // Sidebar width on desktop
          )}
        >
          <div className="h-full">{children}</div>
        </main>
      </div>

      {/* Bottom nav - mobile only */}
      {!hideNav && (
        <div className="lg:hidden">
          <BottomNav />
        </div>
      )}
    </div>
  );
}
