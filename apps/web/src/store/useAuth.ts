import { create } from 'zustand';
import type { User } from '@medsupply/shared-types';

/**
 * `restoring` is the state the app starts in, before it knows whether the
 * browser is holding a live session.
 *
 * Without it there is no way to tell "signed out" from "not asked yet", so
 * every route guard treated a page load as a sign-out. That is why a refresh,
 * a new tab, or following a link into the app dropped the user on the login
 * screen mid-order — and why an end-to-end test could restore the session
 * cookie and still land on `/login`.
 */
export type AuthStatus = 'restoring' | 'ready';

interface AuthState {
  user: User | null;
  /**
   * Held in memory only, never in web storage. It is short-lived and re-minted
   * from the HTTP-only refresh cookie on every load, so there is nothing here
   * for a script on the page to steal.
   */
  accessToken: string | null;
  isAuthenticated: boolean;
  status: AuthStatus;
  setAuth: (user: User, accessToken: string) => void;
  setAccessToken: (accessToken: string) => void;
  markReady: () => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,
  status: 'restoring',
  setAuth: (user, accessToken) =>
    set({ user, accessToken, isAuthenticated: true, status: 'ready' }),
  setAccessToken: (accessToken) => set({ accessToken }),
  markReady: () => set({ status: 'ready' }),
  logout: () => set({ user: null, accessToken: null, isAuthenticated: false, status: 'ready' }),
}));
