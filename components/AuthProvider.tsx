/**
 * AuthProvider — the session, resolved once and shared.
 *
 * Mount above everything that renders. It resolves the stored session on boot,
 * subscribes to changes, and — crucially — keeps the sync space in step: when
 * you sign in, `spaceKey` becomes your account id so the phone and the
 * extension converge without a pairing code; when you sign out, the local
 * pairing key comes back and the library stays exactly where it was.
 *
 * `ready` is what screens gate on. It goes true once we know whether there IS a
 * session — including immediately, when this build has no auth configured — so
 * nothing has to render a guess.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import {
  getSession,
  isAuthConfigured,
  onAuthChange,
  signOut as authSignOut,
  spaceKeyFor,
} from '@/lib/auth';
import { adoptAccountSpace, releaseAccountSpace } from '@/lib/sync';

interface AuthContextValue {
  /** False until the stored session has been read. */
  ready: boolean;
  session: Session | null;
  user: User | null;
  /** True when this build has an identity provider wired up at all. */
  configured: boolean;
  signOut: () => Promise<void>;
  /** Force a re-read — used after a sign-in completes on another screen. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  ready: true,
  session: null,
  user: null,
  configured: false,
  signOut: async () => {},
  refresh: async () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const configured = isAuthConfigured();
  const [session, setSession] = useState<Session | null>(null);
  // With no provider there is nothing to wait for — start ready so the app
  // doesn't hold a frame on a question that has no answer.
  const [ready, setReady] = useState(!configured);

  /**
   * Point sync at the right space for the current session. Best-effort: a
   * failure here must never block sign-in, it just means the next sync pass
   * picks it up.
   */
  const syncSpace = useCallback(async (next: Session | null) => {
    try {
      const key = spaceKeyFor(next?.user);
      if (key) await adoptAccountSpace(key);
      else await releaseAccountSpace();
    } catch {
      // Non-fatal by design.
    }
  }, []);

  const refresh = useCallback(async () => {
    const next = await getSession();
    setSession(next);
    await syncSpace(next);
    setReady(true);
  }, [syncSpace]);

  useEffect(() => {
    if (!configured) return;
    let alive = true;

    getSession()
      .then((next) => {
        if (!alive) return;
        setSession(next);
        setReady(true);
        void syncSpace(next);
      })
      .catch(() => {
        if (alive) setReady(true);
      });

    const unsubscribe = onAuthChange((next) => {
      if (!alive) return;
      setSession(next);
      setReady(true);
      void syncSpace(next);
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [configured, syncSpace]);

  const signOut = useCallback(async () => {
    await authSignOut();
    setSession(null);
    await syncSpace(null);
  }, [syncSpace]);

  const value = useMemo<AuthContextValue>(
    () => ({ ready, session, user: session?.user ?? null, configured, signOut, refresh }),
    [ready, session, configured, signOut, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
