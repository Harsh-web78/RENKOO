"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  AuthState,
  DismissReason,
  GoogleConnection,
  AnalysisStatus,
  FixRecommendation,
  OnboardingState,
  ProductState,
  PropertyProductState,
  User,
} from "./types";
import { emptyOnboardingState } from "./onboarding";
import { MEASUREMENT_WINDOW_DAYS, addDays, seedPropertyState, simulateOutcome } from "./product-service";

/**
 * MOCK SESSION — development only.
 *
 * There is no backend yet, so this stands in for what will eventually be
 * real server-side session + database state. It persists to
 * localStorage purely so onboarding "resume" behavior and the core
 * product's fix lifecycle are demonstrable across page loads — it stores
 * no secrets and makes no security guarantee. This whole module is what
 * gets deleted, not migrated, when real auth/backend exist; screens
 * should depend on the exported types, not on this implementation.
 */

const STORAGE_KEY = "renko-mock-session-v1";

interface StoredSession {
  auth: AuthState;
  onboarding: OnboardingState;
  product: ProductState;
}

const emptySession: StoredSession = {
  auth: { status: "logged-out", user: null },
  onboarding: emptyOnboardingState,
  product: { byProperty: {} },
};

/** Returns the property's product state, seeding it deterministically on first access. */
function getOrSeedPropertyState(session: StoredSession, propertyId: string): PropertyProductState {
  const existing = session.product.byProperty[propertyId];
  if (existing) return existing;
  const onboardingFix = propertyId === session.onboarding.propertyId ? session.onboarding.fix : null;
  return seedPropertyState(propertyId, onboardingFix);
}

function withPropertyState(
  session: StoredSession,
  propertyId: string,
  updater: (state: PropertyProductState) => PropertyProductState
): StoredSession {
  const current = getOrSeedPropertyState(session, propertyId);
  return {
    ...session,
    product: { byProperty: { ...session.product.byProperty, [propertyId]: updater(current) } },
  };
}

interface SessionContextValue extends StoredSession {
  hydrated: boolean;
  signIn: (user: User) => void;
  signOut: () => void;
  setWorkspaceName: (name: string) => void;
  setConnection: (connection: GoogleConnection) => void;
  /** Onboarding-flow property selection: clears any in-flight analysis/fix for a genuinely new choice. */
  selectProperty: (propertyId: string) => void;
  setAnalysisStatus: (status: AnalysisStatus | null) => void;
  setFix: (fix: FixRecommendation | null) => void;
  /** Product-level property switching: just moves the active pointer, product state per property is independent. */
  setActiveProperty: (propertyId: string) => void;
  /** Ensures a property has seeded product state — safe to call on every product-page mount. */
  ensurePropertyState: (propertyId: string) => void;
  getPropertyState: (propertyId: string) => PropertyProductState;
  /** Simulates a successful refresh/retry/recheck — resolves stale/connection-error/insufficient-data to an honest "checked, nothing yet" state. */
  refreshProperty: (propertyId: string) => void;
  markFixReviewed: (propertyId: string) => void;
  applyFix: (propertyId: string) => void;
  checkForResults: (propertyId: string) => void;
  acknowledgeOutcome: (propertyId: string) => void;
  dismissFix: (propertyId: string, reason: DismissReason) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StoredSession>(emptySession);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<StoredSession>;
        // Defensive merge: sessions saved before Prompt 4 won't have `product` yet.
        setSession({ ...emptySession, ...parsed, product: parsed.product ?? emptySession.product });
      }
    } catch {
      // Corrupt or inaccessible storage — fall back to a clean mock session.
    }
    setHydrated(true);
  }, []);

  // `persist` takes an *updater function*, not a precomputed object, and
  // applies it via React's functional setState form. This is the fix for a
  // real bug found during Prompt 3 verification: several setters are called
  // from long-lived closures, and reading the outer `session` variable
  // directly would silently overwrite whatever another call had just set in
  // between. Always deriving the next value from the previous state (not a
  // captured render's snapshot) removes that whole class of race — which
  // matters even more here, since fix actions can fire in quick succession.
  const persist = useCallback((updater: (prev: StoredSession) => StoredSession) => {
    setSession((prev) => {
      const next = updater(prev);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Best-effort only — this is mock state, not a real session store.
      }
      return next;
    });
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      ...session,
      hydrated,
      signIn: (user) => persist((prev) => ({ ...prev, auth: { status: "authenticated", user } })),
      signOut: () => persist(() => emptySession),
      setWorkspaceName: (name) =>
        persist((prev) => ({ ...prev, onboarding: { ...prev.onboarding, workspaceName: name } })),
      setConnection: (connection) =>
        persist((prev) => ({ ...prev, onboarding: { ...prev.onboarding, connection } })),
      selectProperty: (propertyId) =>
        persist((prev) => ({
          ...prev,
          onboarding:
            propertyId === prev.onboarding.propertyId
              ? prev.onboarding
              : { ...prev.onboarding, propertyId, analysisStatus: null, fix: null },
        })),
      setAnalysisStatus: (analysisStatus) =>
        persist((prev) => ({ ...prev, onboarding: { ...prev.onboarding, analysisStatus } })),
      setFix: (fix) => persist((prev) => ({ ...prev, onboarding: { ...prev.onboarding, fix } })),

      setActiveProperty: (propertyId) =>
        persist((prev) => ({ ...prev, onboarding: { ...prev.onboarding, propertyId } })),

      ensurePropertyState: (propertyId) =>
        persist((prev) =>
          prev.product.byProperty[propertyId]
            ? prev
            : withPropertyState(prev, propertyId, (s) => s)
        ),

      getPropertyState: (propertyId) => getOrSeedPropertyState(session, propertyId),

      refreshProperty: (propertyId) =>
        persist((prev) =>
          withPropertyState(prev, propertyId, (s) => {
            const now = new Date().toISOString();
            return {
              ...s,
              noFixReason: "no-fix",
              lastCheckedAt: now,
              nextCheckAt: addDays(now, 7),
              lastSuccessfulDataAt: now,
            };
          })
        ),

      markFixReviewed: (propertyId) =>
        persist((prev) =>
          withPropertyState(prev, propertyId, (s) =>
            s.currentFix && s.currentFix.status === "available"
              ? { ...s, currentFix: { ...s.currentFix, status: "reviewed" } }
              : s
          )
        ),

      applyFix: (propertyId) =>
        persist((prev) =>
          withPropertyState(prev, propertyId, (s) => {
            if (!s.currentFix) return s;
            const now = new Date().toISOString();
            return {
              ...s,
              currentFix: {
                ...s.currentFix,
                status: "applied",
                appliedAt: now,
                baseline: { clicks: s.currentFix.clicks, ctr: s.currentFix.ctr, position: s.currentFix.position, capturedAt: now },
                expectedMeasurementDate: addDays(now, MEASUREMENT_WINDOW_DAYS),
              },
            };
          })
        ),

      checkForResults: (propertyId) =>
        persist((prev) =>
          withPropertyState(prev, propertyId, (s) => {
            if (!s.currentFix || s.currentFix.status !== "applied" || s.currentFix.outcome) return s;
            const now = new Date().toISOString();
            const outcome = simulateOutcome(s.currentFix, now);
            const measuredFix = { ...s.currentFix, outcome };
            // The outcome is now visible as the *current* fix (OUTCOME_AVAILABLE) and is
            // simultaneously recorded in history — acknowledging it later only clears the
            // current slot, it does not duplicate the history entry.
            return {
              ...s,
              currentFix: measuredFix,
              history: [
                {
                  id: measuredFix.id,
                  fix: measuredFix,
                  page: measuredFix.page,
                  recommendedChange: measuredFix.recommendedChange,
                  status: "measured",
                  appliedAt: measuredFix.appliedAt ?? now,
                  outcome,
                },
                ...s.history,
              ],
            };
          })
        ),

      acknowledgeOutcome: (propertyId) =>
        persist((prev) =>
          withPropertyState(prev, propertyId, (s) => {
            if (!s.currentFix?.outcome) return s;
            const now = new Date().toISOString();
            return {
              ...s,
              currentFix: null,
              noFixReason: "no-fix",
              lastCheckedAt: now,
              nextCheckAt: addDays(now, 7),
            };
          })
        ),

      dismissFix: (propertyId, reason) =>
        persist((prev) =>
          withPropertyState(prev, propertyId, (s) => {
            if (!s.currentFix) return s;
            const now = new Date().toISOString();
            const dismissed = { ...s.currentFix, status: "dismissed" as const, dismissReason: reason };
            return {
              ...s,
              currentFix: null,
              noFixReason: "no-fix",
              lastCheckedAt: now,
              nextCheckAt: addDays(now, 7),
              history: [
                {
                  id: dismissed.id,
                  fix: dismissed,
                  page: dismissed.page,
                  recommendedChange: dismissed.recommendedChange,
                  status: "dismissed",
                  appliedAt: null,
                  dismissReason: reason,
                },
                ...s.history,
              ],
            };
          })
        ),
    }),
    [session, hydrated, persist]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
