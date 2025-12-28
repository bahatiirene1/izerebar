/**
 * Auth Store
 * @implements ARCHITECTURE.md Section 8 - UI Layer
 *
 * Manages authentication state with persistence
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type UserRole = 'owner' | 'manager' | 'bartender' | 'server' | 'kitchen';

export interface User {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
}

export interface Bar {
  id: string;
  name: string;
  tin: string;
  location?: string;
}

interface AuthState {
  // State
  user: User | null;
  bar: Bar | null;
  token: string | null;
  deviceId: string;
  isAuthenticated: boolean;

  // Actions
  login: (user: User, bar: Bar, token: string) => void;
  logout: () => void;
  updateUser: (user: Partial<User>) => void;
  setBar: (bar: Bar) => void;
}

// Generate or retrieve device ID
function getDeviceId(): string {
  const stored = localStorage.getItem('izerebar-device-id');
  if (stored) return stored;

  const newId = `device-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  localStorage.setItem('izerebar-device-id', newId);
  return newId;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      bar: null,
      token: null,
      deviceId: getDeviceId(),
      isAuthenticated: false,

      login: (user, bar, token) => {
        set({
          user,
          bar,
          token,
          isAuthenticated: true,
        });
      },

      logout: () => {
        set({
          user: null,
          bar: null,
          token: null,
          isAuthenticated: false,
        });
      },

      updateUser: (updates) => {
        const { user } = get();
        if (user) {
          set({ user: { ...user, ...updates } });
        }
      },

      setBar: (bar) => {
        set({ bar });
      },
    }),
    {
      name: 'izerebar-auth',
      partialize: (state) => ({
        user: state.user,
        bar: state.bar,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

// Selector hooks for common use cases
export const useUser = () => useAuthStore((state) => state.user);
export const useBar = () => useAuthStore((state) => state.bar);
export const useToken = () => useAuthStore((state) => state.token);
export const useIsAuthenticated = () => useAuthStore((state) => state.isAuthenticated);
export const useUserRole = () => useAuthStore((state) => state.user?.role);
