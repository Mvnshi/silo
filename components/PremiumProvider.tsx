/**
 * PremiumProvider — the entitlement, resolved once and shared.
 *
 * Mounts inside AuthProvider so purchases can be attached to the signed-in
 * identity: RevenueCat keys purchases by an app user id, and handing it the
 * account id is what lets a subscription follow someone to a second device.
 * Signed out (or with accounts unconfigured) it stays anonymous, which is
 * still correct — the purchase belongs to the App Store account either way.
 *
 * `ready` goes true immediately when billing is unconfigured, so an
 * unconfigured build never holds a frame waiting for an answer that cannot
 * exist. See `lib/billing.ts` for the degradation contract.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  Entitlement,
  OPEN,
  SubscriptionHistory,
  initBilling,
  isBillingAvailable,
  isBillingConfigured,
  linkBillingUser,
  refreshEntitlement,
  subscriptionHistory,
  unlinkBillingUser,
} from '@/lib/billing';
import { useAuth } from '@/components/AuthProvider';
import { syncTrialReminder } from '@/lib/notifications';
import { TRIAL_REMINDER_DAYS_BEFORE } from '@/lib/config';

interface PremiumContextValue {
  /** False until the entitlement has been resolved at least once. */
  ready: boolean;
  entitlement: Entitlement;
  /**
   * What this install has held before. Needed to tell a lapsed subscriber from
   * someone who never subscribed — the entitlement alone cannot, because a
   * lapse resolves to the locked state and forgets there ever was one.
   */
  history: SubscriptionHistory;
  /** The single question screens ask. True whenever billing is unconfigured. */
  isPremium: boolean;
  /** True when this build can actually sell — gates the whole billing UI. */
  configured: boolean;
  /** Configured to sell, but the native module is missing (Expo Go / old dev client). */
  unavailable: boolean;
  refresh: () => Promise<void>;
}

const NO_HISTORY: SubscriptionHistory = {
  everSubscribed: false,
  lastExpiry: null,
  productId: null,
};

const PremiumContext = createContext<PremiumContextValue>({
  ready: true,
  entitlement: OPEN,
  history: NO_HISTORY,
  isPremium: true,
  configured: false,
  unavailable: false,
  refresh: async () => {},
});

export function usePremium(): PremiumContextValue {
  return useContext(PremiumContext);
}

export default function PremiumProvider({ children }: { children: React.ReactNode }) {
  const configured = isBillingConfigured();
  const { user } = useAuth();
  const [entitlement, setEntitlement] = useState<Entitlement>(OPEN);
  const [history, setHistory] = useState<SubscriptionHistory>(NO_HISTORY);
  const [ready, setReady] = useState(!configured);
  const linkedUserRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!configured) return;
    setEntitlement(await refreshEntitlement());
    // Read AFTER the refresh: the entitlement write is what records history,
    // so reading first would miss the subscription that just became known.
    setHistory(subscriptionHistory());
  }, [configured]);

  useEffect(() => {
    if (!configured) return;
    let alive = true;
    initBilling(user?.id ?? null)
      .then((next) => {
        if (!alive) return;
        setEntitlement(next);
        setHistory(subscriptionHistory());
        setReady(true);
      })
      .catch(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
    // Deliberately not keyed on `user`: configure runs once, and identity
    // changes are handled by the logIn/logOut effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

  // Follow the session. Signing in attaches existing purchases to the account;
  // signing out detaches so the next user doesn't inherit them.
  useEffect(() => {
    if (!configured) return;
    const id = user?.id ?? null;
    if (id === linkedUserRef.current) return;
    linkedUserRef.current = id;
    let alive = true;
    (async () => {
      if (id) await linkBillingUser(id);
      else await unlinkBillingUser();
      if (alive) await refresh();
    })();
    return () => {
      alive = false;
    };
  }, [configured, user?.id, refresh]);

  /**
   * Keep the trial reminder in step with whatever the entitlement now says.
   *
   * Driven from here rather than from the purchase call site so it is
   * self-healing: a restore on a new device, a trial cancelled in iOS Settings,
   * or an entitlement that arrived through the SDK's own update listener all
   * land here on the next refresh. `syncTrialReminder` cancels its own lane
   * first, so this is safe to run on every change.
   */
  useEffect(() => {
    if (!configured) return;
    void syncTrialReminder(entitlement, TRIAL_REMINDER_DAYS_BEFORE);
  }, [configured, entitlement]);

  /**
   * Re-check on foreground. A subscription can be started, cancelled or
   * recovered in the App Store while Silo is backgrounded, and the entitlement
   * would otherwise stay stale until the next launch.
   */
  useEffect(() => {
    if (!configured) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => sub.remove();
  }, [configured, refresh]);

  const value = useMemo<PremiumContextValue>(
    () => ({
      ready,
      entitlement,
      history,
      isPremium: !configured || entitlement.active,
      configured,
      unavailable: configured && !isBillingAvailable(),
      refresh,
    }),
    [ready, entitlement, history, configured, refresh]
  );

  return <PremiumContext.Provider value={value}>{children}</PremiumContext.Provider>;
}
