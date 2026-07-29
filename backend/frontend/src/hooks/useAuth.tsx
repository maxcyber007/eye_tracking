"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { auth } from "@/lib/api";
import type { UserPayload } from "@/lib/types";

interface AuthContextValue {
  user: UserPayload | null;
  authEnabled: boolean;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Session state for the dashboard.
 *
 * The session cookie is HttpOnly, so the client cannot inspect it. Auth state
 * is therefore always derived from `GET /api/auth/status` rather than from
 * anything stored locally, which keeps the client and server from disagreeing
 * after an expiry.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserPayload | null>(null);
  const [authEnabled, setAuthEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const status = await auth.status();
      setAuthEnabled(status.auth_enabled);
      setUser(status.authenticated ? status.user : null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async (username: string, password: string) => {
    const result = await auth.login(username, password);
    setUser(result.user);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await auth.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, authEnabled, loading, signIn, signOut, refresh }),
    [user, authEnabled, loading, signIn, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth ต้องใช้ภายใน <AuthProvider>");
  return context;
}

/**
 * Redirect to the login page when no session is active.
 *
 * @param next Path to return to after a successful sign-in.
 */
export function useRequireAuth(next?: string): AuthContextValue {
  const context = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (context.loading) return;
    if (context.authEnabled && !context.user) {
      // `usePathname` is already relative to `basePath`, and `router.replace`
      // adds `basePath` back on. Using `window.location.pathname` here would
      // include it twice and land on /ui/ui/dashboard.
      const target = next ?? pathname;
      router.replace(`/login/?next=${encodeURIComponent(target)}`);
    }
  }, [context.loading, context.authEnabled, context.user, router, next, pathname]);

  return context;
}
