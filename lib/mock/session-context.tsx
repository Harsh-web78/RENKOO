"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  AuthState,
  DismissReason,
  GoogleConnection,
  AnalysisStatus,
  FixRecommendation,
  HistoryItem,
  OnboardingState,
  ProductState,
  PropertyProductState,
  SearchConsoleProperty,
  User,
} from "./types";
import { emptyOnboardingState } from "./onboarding";
import { MEASUREMENT_WINDOW_DAYS, addDays, seedPropertyState, simulateOutcome } from "./product-service";
import type { DataError } from "../data-contract/errors.ts";
import { dataError } from "../data-contract/errors.ts";
import {
  createApiProvider,
  createWorkspaceApi,
  fetchConnectionStatus,
  fetchSessionContext,
  logInApi,
  logOutApi,
  mapAuthErrorToForm,
  signUpApi,
} from "../data-contract/api-provider.ts";
import {
  applyRecommendationAndFix,
  backendRecommendationToOnboardingFix,
  discardStateForPropertySwitch,
  filterHistoryByProperty,
  initialRealPropertyState,
  isMeasurementPending,
  pendingNoticeFor,
  readRealPropertyPointer,
  writeRealPropertyPointer,
} from "../data-contract/real-state.ts";

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
 *
 * PROMPT 13: real mode lives in `RealSessionProvider` below. The mock
 * path is unchanged and remains the default (`mode="mock"`).
 * `AppProviders` selects the mode centrally via
 * `NEXT_PUBLIC_USE_REAL_PROVIDER` — no component reads the flag directly.
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

export type ProviderMode = "mock" | "real";

/** Result of the real-mode auth methods (mirrors the mock AuthResult shape). */
export interface RealAuthResult {
  ok: boolean;
  user?: User;
  workspaceName?: string;
  errorCode?: "email-exists" | "invalid-credentials" | "rate-limited" | "network-failure" | "server-error";
  message?: string;
}

export interface RealHistoryDetailEntry {
  status: "loading" | "ready" | "error";
  item: HistoryItem | null;
  error: DataError | null;
}

interface SessionContextValue extends StoredSession {
  hydrated: boolean;
  providerMode: ProviderMode;
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
  /* ---- Real-mode extras (neutral defaults under mock) ---- */
  /** True once the authenticated session + property list attempt finished. */
  realSessionLoaded: boolean;
  realSessionError: DataError | null;
  /** Workspace from the authenticated session — never from client storage. */
  realWorkspace: { id: string; name: string } | null;
  /** Authorized properties from the backend (drives PropertySwitcher in real mode). */
  realProperties: SearchConsoleProperty[];
  realPropertyStatus: Record<string, "loading" | "ready" | "error">;
  realPropertyError: Record<string, DataError | null>;
  realActionPending: boolean;
  realActionError: DataError | null;
  /** Honest pending copy per property after a `measurement_pending` check. */
  measurementNotice: Record<string, string | null>;
  reloadRealProperty: (propertyId: string) => void;
  findHistoryItem: (fixId: string) => HistoryItem | null;
  /* ---- Real-mode backend history (source of truth when real) ---- */
  realHistory: HistoryItem[];
  realHistoryStatus: "loading" | "ready" | "error";
  realHistoryError: DataError | null;
  reloadRealHistory: () => void;
  realHistoryDetail: Record<string, RealHistoryDetailEntry>;
  loadRealHistoryDetail: (fixId: string) => void;
  /* ---- Real-mode workspace + auth ---- */
  realWorkspaces: { id: string; name: string; plan: string }[];
  signUpReal: (email: string, password: string) => Promise<RealAuthResult>;
  logInReal: (email: string, password: string) => Promise<RealAuthResult>;
  logOutReal: () => Promise<void>;
  /** Re-reads /auth/me and rebuilds workspace/property/history state. */
  refreshSession: () => Promise<void>;
  createWorkspaceReal: (name: string) => Promise<RealAuthResult & { workspaceId?: string }>;
  switchWorkspace: (workspaceId: string) => void;
  /**
   * Real-mode analysis: triggers backend ingestion for the property, then
   * reads the backend recommendation. Mirrors the mock analysis callback
   * contract (status transitions + onboarding fix) so the Analyzing screen
   * doesn't change shape — but every fact comes from the backend.
   */
  runRealAnalysis: (propertyId: string, onStatusChange: (status: AnalysisStatus) => void) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function MockSessionProvider({ children }: { children: ReactNode }) {
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
      providerMode: "mock",
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

      realSessionLoaded: false,
      realSessionError: null,
      realWorkspace: null,
      realProperties: [],
      realPropertyStatus: {},
      realPropertyError: {},
      realActionPending: false,
      realActionError: null,
      measurementNotice: {},
      reloadRealProperty: () => {},
      findHistoryItem: (fixId) => {
        // Mock ids are `${propertyId}::...` — scope the lookup to that property.
        const propertyId = fixId.split("::")[0];
        if (!propertyId) return null;
        const state = getOrSeedPropertyState(session, propertyId);
        return state.history.find((h) => h.id === fixId) ?? null;
      },
      realHistory: [],
      realHistoryStatus: "ready",
      realHistoryError: null,
      reloadRealHistory: () => {},
      realHistoryDetail: {},
      loadRealHistoryDetail: () => {},
      realWorkspaces: [],
      signUpReal: async () => ({ ok: false, errorCode: "server-error", message: "Not available in mock mode." }),
      logInReal: async () => ({ ok: false, errorCode: "server-error", message: "Not available in mock mode." }),
      logOutReal: async () => {},
      refreshSession: async () => {},
      createWorkspaceReal: async () => ({ ok: false, errorCode: "server-error", message: "Not available in mock mode." }),
      switchWorkspace: () => {},
      runRealAnalysis: async () => {},
    }),
    [session, hydrated, persist]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function toDataError(error: unknown): DataError {
  if (error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string") {
    const record = error as { code: string; message?: unknown };
    return dataError(
      record.code as DataError["code"],
      typeof record.message === "string" && record.message.length > 0 ? record.message : "Something went wrong.",
    );
  }
  return dataError("UNKNOWN_ERROR", "Something went wrong.");
}

type ApiClient = ReturnType<typeof createApiProvider>;

/**
 * REAL SESSION — Prompt 13.
 *
 * Thin async shell over the real NestJS backend. Same `SessionContextValue`
 * shape so screens don't change; data comes from the authenticated
 * workspace context (`GET /auth/me` → workspace → properties → per-property
 * recommendation/fix). The backend owns the Fix lifecycle; this layer only
 * caches view state per property and discards it on property switch.
 *
 * Storage: only the selected-property *pointer* touches localStorage
 * (`renko-real-property-v1`, validated against the authorized list on
 * every load). No session ids, no CSRF tokens, no Google tokens — ever.
 *
 * History limitation: the backend exposes no history endpoint yet, so
 * dismiss/acknowledge/measured entries are session-local (see
 * docs/prompt-13-history-limitation.md). Current Fix + outcome always
 * come from the backend.
 */
function RealSessionProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ status: "logged-out", user: null });
  const [onboarding, setOnboarding] = useState<OnboardingState>(emptyOnboardingState);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [sessionError, setSessionError] = useState<DataError | null>(null);
  const [workspace, setWorkspace] = useState<{ id: string; name: string } | null>(null);
  const [allWorkspaces, setAllWorkspaces] = useState<{ id: string; name: string; plan: string }[]>([]);
  const [properties, setProperties] = useState<SearchConsoleProperty[]>([]);
  const [states, setStates] = useState<Record<string, PropertyProductState>>({});
  const [statuses, setStatuses] = useState<Record<string, "loading" | "ready" | "error">>({});
  const [errors, setErrors] = useState<Record<string, DataError | null>>({});
  const [notices, setNotices] = useState<Record<string, string | null>>({});
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<DataError | null>(null);
  // Backend history (workspace-scoped source of truth in real mode).
  const [realHistory, setRealHistory] = useState<HistoryItem[]>([]);
  const [realHistoryStatus, setRealHistoryStatus] = useState<"loading" | "ready" | "error">("loading");
  const [realHistoryError, setRealHistoryError] = useState<DataError | null>(null);
  const [historyDetail, setHistoryDetail] = useState<Record<string, RealHistoryDetailEntry>>({});

  const apiRef = useRef<ApiClient | null>(null);
  const activeRef = useRef<string | null>(null);
  // History lives in the backend; per-property slices mirror it for the
  // existing property-scoped screens. The ref lets async continuations
  // read the latest history without stale closures.
  const historyRef = useRef(realHistory);
  historyRef.current = realHistory;
  const bootedRef = useRef(false);

  const loadProperty = useCallback(async (api: ApiClient, propertyId: string, historyOverride?: HistoryItem[]) => {
    setStatuses((prev) => ({ ...prev, [propertyId]: "loading" }));
    setErrors((prev) => ({ ...prev, [propertyId]: null }));
    try {
      const [recommendationResult, fixPayload] = await Promise.all([
        api.getRecommendationResult(propertyId),
        api.getFix(propertyId),
      ]);
      // Stale-response guard: a property switch mid-flight must not paint
      // the previous property's data into the new selection.
      if (activeRef.current !== propertyId) return;
      const localHistory = historyOverride ?? filterHistoryByProperty(historyRef.current, propertyId);
      const next = applyRecommendationAndFix({
        recommendationResult,
        fix: fixPayload.fix,
        recommendation: fixPayload.recommendation,
        localHistory,
      });
      setStates((prev) => ({ ...prev, [propertyId]: next }));
      setStatuses((prev) => ({ ...prev, [propertyId]: "ready" }));
    } catch (error) {
      if (activeRef.current !== propertyId) return;
      const mapped = toDataError(error);
      setErrors((prev) => ({ ...prev, [propertyId]: mapped }));
      setStatuses((prev) => ({ ...prev, [propertyId]: "error" }));
    }
  }, []);

  /** Fetches workspace history from the backend and mirrors per-property slices. Returns the items. */
  const loadHistory = useCallback(async (api: ApiClient): Promise<HistoryItem[]> => {
    setRealHistoryStatus("loading");
    setRealHistoryError(null);
    try {
      const { items } = await api.listHistory();
      setRealHistory(items);
      setRealHistoryStatus("ready");
      setStates((prev) => {
        const next = { ...prev };
        for (const propertyId of Object.keys(next)) {
          const slice = filterHistoryByProperty(items, propertyId);
          if (next[propertyId]!.history !== slice) {
            next[propertyId] = { ...next[propertyId]!, history: slice };
          }
        }
        return next;
      });
      return items;
    } catch (error) {
      const mapped = toDataError(error);
      setRealHistoryError(mapped);
      setRealHistoryStatus("error");
      return historyRef.current;
    }
  }, []);

  // Session → workspace → authorized properties → validated property
  // pointer → per-property data + backend history. Re-runnable: after
  // login/signup (new session) and after workspace switches it clears
  // every stale cache first.
  const initializeFromSession = useCallback(
    async (preferredWorkspaceId?: string) => {
      // Discard stale workspace/property/history state before rebuilding.
      const cleared = discardStateForPropertySwitch({ states: {}, statuses: {}, errors: {}, notices: {} });
      setStates(cleared.states);
      setStatuses(cleared.statuses);
      setErrors(cleared.errors);
      setNotices(cleared.notices);
      setRealHistory([]);
      setRealHistoryStatus("loading");
      setRealHistoryError(null);
      setHistoryDetail({});
      setActionError(null);
      setSessionLoaded(false);
      try {
        const session = await fetchSessionContext();
        setAllWorkspaces(session.workspaces);
        const chosen =
          (preferredWorkspaceId && session.workspaces.find((w) => w.id === preferredWorkspaceId)) ??
          session.workspaces[0] ??
          null;
        if (!chosen) {
          setSessionError(dataError("PERMISSION_DENIED", "Your account has no workspace yet."));
          setWorkspace(null);
          setProperties([]);
          setRealHistoryStatus("ready");
          setSessionLoaded(true);
          return;
        }
        setSessionError(null);
        setAuth({ status: "authenticated", user: session.user });
        setWorkspace({ id: chosen.id, name: chosen.name });
        // Flow-state (analysis/fix) always re-derives from the backend for
        // the active session — never inherited across logins/refreshes.
        setOnboarding((prev) => ({ ...prev, workspaceName: chosen.name, analysisStatus: null, fix: null }));
        const api = createApiProvider(chosen.id);
        apiRef.current = api;
        // Connection truth comes from the backend (best-effort display).
        try {
          const status = await fetchConnectionStatus(chosen.id);
          setOnboarding((prev) => ({
            ...prev,
            connection: status.connected
              ? { status: "connected", ...(status.googleAccountEmail ? { googleAccountEmail: status.googleAccountEmail } : {}) }
              : { status: "not-connected" },
          }));
        } catch {
          // Leave the default not-connected state — product pages don't depend on it.
        }
        const props = await api.listProperties();
        setProperties(props);
        const pointer = readRealPropertyPointer();
        const pointerValid = pointer && props.some((p) => p.id === pointer) ? pointer : null;
        const firstSelectable = props.filter((p) => p.selectable)[0] ?? props[0] ?? null;
        const active = pointerValid ?? firstSelectable?.id ?? null;
        setOnboarding((prev) => ({ ...prev, propertyId: active }));
        activeRef.current = active;
        if (active) await loadProperty(api, active);
        await loadHistory(api);
        setSessionLoaded(true);
      } catch (error) {
        setSessionError(toDataError(error));
        setRealHistoryStatus("error");
        setSessionLoaded(true);
      }
    },
    [loadProperty, loadHistory],
  );

  // Initial boot: reconstruct the authenticated session from the server
  // session cookie (/auth/me). Runs once.
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    void initializeFromSession();
  }, [initializeFromSession]);

  const switchToProperty = useCallback(
    (propertyId: string) => {
      // Discard ALL cached recommendation/fix state before fetching the
      // new property — never display the previous property's data.
      const cleared = discardStateForPropertySwitch({ states: {}, statuses: {}, errors: {}, notices: {} });
      setStates(cleared.states);
      setStatuses(cleared.statuses);
      setErrors(cleared.errors);
      setNotices(cleared.notices);
      setActionError(null);
      activeRef.current = propertyId;
      writeRealPropertyPointer(propertyId);
      setOnboarding((prev) => ({ ...prev, propertyId }));
      const api = apiRef.current;
      if (api) void loadProperty(api, propertyId);
    },
    [loadProperty],
  );

  const refreshFix = useCallback(async (api: ApiClient, propertyId: string) => {
    const payload = await api.getFix(propertyId);
    if (activeRef.current !== propertyId) return;
    if (!payload.fix) return;
    const fresh = payload.fix;
    setStates((prev) => {
      const current = prev[propertyId];
      if (!current) return prev;
      // The backend Fix (with its embedded recommendation/evidence) is the
      // source of truth — replace, preserving session-local history.
      return {
        ...prev,
        [propertyId]: { ...current, currentFix: fresh, lastSuccessfulDataAt: fresh.dataMeta.dataThrough },
      };
    });
  }, []);

  const runAction = useCallback(async (propertyId: string, fn: (api: ApiClient) => Promise<void>) => {
    const api = apiRef.current;
    if (!api) {
      setActionError(dataError("AUTH_REQUIRED", "Sign in again to continue."));
      return;
    }
    setActionPending(true);
    setActionError(null);
    try {
      await fn(api);
    } catch (error) {
      setActionError(toDataError(error));
    } finally {
      setActionPending(false);
    }
  }, []);

  /** Clears every piece of real-mode client state (logout / workspace switch). */
  const resetRealState = useCallback(() => {
    apiRef.current = null;
    activeRef.current = null;
    writeRealPropertyPointer(null);
    setAuth({ status: "logged-out", user: null });
    setOnboarding(emptyOnboardingState);
    setWorkspace(null);
    setAllWorkspaces([]);
    setProperties([]);
    setStates({});
    setStatuses({});
    setErrors({});
    setNotices({});
    setRealHistory([]);
    setRealHistoryStatus("loading");
    setRealHistoryError(null);
    setHistoryDetail({});
    setActionError(null);
  }, []);

  const logOutReal = useCallback(async (): Promise<void> => {
    try {
      await logOutApi();
    } catch {
      // Best-effort server logout; local state always clears.
    } finally {
      resetRealState();
      setSessionError(dataError("AUTH_REQUIRED", "Sign in again to continue."));
    }
  }, [resetRealState]);

  const signUpReal = useCallback(
    async (email: string, password: string): Promise<RealAuthResult> => {
      try {
        const result = await signUpApi(email, password);
        setAuth({ status: "authenticated", user: result.user });
        await initializeFromSession(result.workspace?.id);
        return { ok: true, user: result.user, workspaceName: result.workspace?.name };
      } catch (error) {
        const mapped = mapAuthErrorToForm(error);
        return { ok: false, errorCode: mapped.errorCode, message: mapped.message };
      }
    },
    [initializeFromSession],
  );

  const logInReal = useCallback(
    async (email: string, password: string): Promise<RealAuthResult> => {
      try {
        const result = await logInApi(email, password);
        setAuth({ status: "authenticated", user: result.user });
        await initializeFromSession();
        const workspaceName = result.workspaces?.[0]?.name;
        return { ok: true, user: result.user, ...(workspaceName ? { workspaceName } : {}) };
      } catch (error) {
        const mapped = mapAuthErrorToForm(error);
        return { ok: false, errorCode: mapped.errorCode, message: mapped.message };
      }
    },
    [initializeFromSession],
  );

  const createWorkspaceReal = useCallback(
    async (name: string): Promise<RealAuthResult & { workspaceId?: string }> => {
      try {
        const workspace = await createWorkspaceApi(name);
        await initializeFromSession(workspace.id);
        return { ok: true, workspaceName: workspace.name, workspaceId: workspace.id };
      } catch (error) {
        const mapped = mapAuthErrorToForm(error);
        return { ok: false, errorCode: mapped.errorCode, message: mapped.message };
      }
    },
    [initializeFromSession],
  );

  const switchWorkspace = useCallback(
    (workspaceId: string) => {
      writeRealPropertyPointer(null);
      void initializeFromSession(workspaceId);
    },
    [initializeFromSession],
  );

  const loadRealHistoryDetail = useCallback(async (fixId: string) => {    const api = apiRef.current;
    if (!api) {
      setHistoryDetail((prev) => ({
        ...prev,
        [fixId]: { status: "error", item: null, error: dataError("AUTH_REQUIRED", "Sign in again to continue.") },
      }));
      return;
    }
    // Detail always re-fetches — never relies on stale local state.
    setHistoryDetail((prev) => ({ ...prev, [fixId]: { status: "loading", item: null, error: null } }));
    try {
      const item = await api.getHistoryDetail(fixId);
      setHistoryDetail((prev) => ({ ...prev, [fixId]: { status: "ready", item, error: null } }));
    } catch (error) {
      setHistoryDetail((prev) => ({ ...prev, [fixId]: { status: "error", item: null, error: toDataError(error) } }));
    }
  }, []);

  const runRealAnalysis = useCallback(async (propertyId: string, onStatusChange: (status: AnalysisStatus) => void) => {
    const api = apiRef.current;
    if (!api) {
      onStatusChange("failed");
      return;
    }
    const report = (status: AnalysisStatus) => {
      setOnboarding((prev) => ({ ...prev, analysisStatus: status }));
      onStatusChange(status);
    };
    try {
      report("queued");
      report("connecting");
      report("loading-data");
      await api.triggerIngest(propertyId);
      report("analyzing");
      report("ranking");
      const result = await api.getRecommendationResult(propertyId);
      if (result.status === "recommendation-available" && result.recommendation) {
        setOnboarding((prev) => ({ ...prev, fix: backendRecommendationToOnboardingFix(result.recommendation!) }));
        report("complete");
      } else if (result.status === "insufficient-data") {
        report("insufficient-data");
      } else if (result.status === "no-signal") {
        report("no-opportunity");
      } else {
        // stale-data / unavailable: the data could not be evaluated honestly.
        report("failed");
      }
      // Warm the product state so Home shows the same backend truth.
      await loadProperty(api, propertyId);
      await loadHistory(api);
    } catch {
      report("failed");
    }
  }, [loadProperty, loadHistory]);

  const value = useMemo<SessionContextValue>(() => {
    const product: ProductState = { byProperty: states };
    return {
      auth,
      onboarding,
      product,
      hydrated: sessionLoaded,
      providerMode: "real",
      signIn: (user) => setAuth({ status: "authenticated", user }),
      signOut: () => {
        void logOutReal();
      },
      setWorkspaceName: (name) => setOnboarding((prev) => ({ ...prev, workspaceName: name })),
      setConnection: (connection) => setOnboarding((prev) => ({ ...prev, connection })),
      selectProperty: (propertyId) => {
        setOnboarding((prev) =>
          propertyId === prev.propertyId
            ? prev
            : { ...prev, propertyId, analysisStatus: null, fix: null },
        );
        if (propertyId !== activeRef.current) switchToProperty(propertyId);
      },
      setAnalysisStatus: (analysisStatus) => setOnboarding((prev) => ({ ...prev, analysisStatus })),
      setFix: (fix) => setOnboarding((prev) => ({ ...prev, fix })),
      setActiveProperty: (propertyId) => {
        if (propertyId === activeRef.current) return;
        switchToProperty(propertyId);
      },
      ensurePropertyState: (propertyId) => {
        const api = apiRef.current;
        if (!api) return;
        setStatuses((prev) => {
          if (prev[propertyId]) return prev;
          void loadProperty(api, propertyId);
          return { ...prev, [propertyId]: "loading" };
        });
      },
      getPropertyState: (propertyId) => states[propertyId] ?? initialRealPropertyState(),
      refreshProperty: (propertyId) => {
        const api = apiRef.current;
        if (!api) return;
        setNotices((prev) => ({ ...prev, [propertyId]: null }));
        void loadProperty(api, propertyId);
      },
      markFixReviewed: (propertyId) => {
        const fixId = states[propertyId]?.currentFix?.id;
        if (!fixId) return;
        void runAction(propertyId, async (api) => {
          await api.reviewFix(propertyId, fixId);
          await refreshFix(api, propertyId);
        });
      },
      applyFix: (propertyId) => {
        const fixId = states[propertyId]?.currentFix?.id;
        if (!fixId) return;
        void runAction(propertyId, async (api) => {
          await api.applyFix(propertyId, fixId);
          await refreshFix(api, propertyId);
        });
      },
      checkForResults: (propertyId) => {
        const fixId = states[propertyId]?.currentFix?.id;
        if (!fixId) return;
        void runAction(propertyId, async (api) => {
          const result = await api.checkFix(propertyId, fixId);
          if (activeRef.current !== propertyId) return;
          if (isMeasurementPending(result)) {
            // Honest pending UX — no success, no fake result.
            setNotices((prev) => ({ ...prev, [propertyId]: pendingNoticeFor(result) }));
            return;
          }
          // Measured (or honestly unmeasurable): the backend owns the
          // outcome — refresh current fix + history from the backend.
          const items = await loadHistory(api);
          if (activeRef.current !== propertyId) return;
          await loadProperty(api, propertyId, filterHistoryByProperty(items, propertyId));
        });
      },
      acknowledgeOutcome: (propertyId) => {
        const fix = states[propertyId]?.currentFix;
        if (!fix?.outcome) return;
        void runAction(propertyId, async (api) => {
          await api.acknowledgeFix(propertyId, fix.id);
          if (activeRef.current !== propertyId) return;
          // Acknowledgement persists server-side (status acknowledged, hidden
          // from current). Reload current state + history from the backend.
          const items = await loadHistory(api);
          if (activeRef.current !== propertyId) return;
          await loadProperty(api, propertyId, filterHistoryByProperty(items, propertyId));
        });
      },
      dismissFix: (propertyId, reason) => {
        const fix = states[propertyId]?.currentFix;
        if (!fix) return;
        void runAction(propertyId, async (api) => {
          await api.dismissFix(propertyId, fix.id, reason);
          if (activeRef.current !== propertyId) return;
          // Dismissed stays dismissed server-side; reload current state and
          // history from the backend (a persisting signal may surface a new
          // recommendation — that is backend truth, not a resurrection).
          const items = await loadHistory(api);
          if (activeRef.current !== propertyId) return;
          await loadProperty(api, propertyId, filterHistoryByProperty(items, propertyId));
        });
      },
      realSessionLoaded: sessionLoaded,
      realSessionError: sessionError,
      realWorkspace: workspace,
      realProperties: properties,
      realPropertyStatus: statuses,
      realPropertyError: errors,
      realActionPending: actionPending,
      realActionError: actionError,
      measurementNotice: notices,
      reloadRealProperty: (propertyId) => {
        const api = apiRef.current;
        if (!api) return;
        setNotices((prev) => ({ ...prev, [propertyId]: null }));
        void loadProperty(api, propertyId);
      },
      findHistoryItem: (fixId) => {
        // Real mode: backend history is the source of truth (workspace-wide).
        const found = realHistory.find((h) => h.id === fixId);
        if (found) return found;
        for (const propertyId of Object.keys(states)) {
          const current = states[propertyId]?.currentFix;
          if (current?.id === fixId) {
            return {
              id: current.id,
              fix: current,
              page: current.page,
              recommendedChange: current.recommendedChange,
              status: current.outcome ? "measured" : "waiting",
              appliedAt: current.appliedAt ?? null,
              outcome: current.outcome,
            };
          }
        }
        return null;
      },
      realHistory,
      realHistoryStatus,
      realHistoryError,
      reloadRealHistory: () => {
        const api = apiRef.current;
        if (api) void loadHistory(api);
      },
      realHistoryDetail: historyDetail,
      loadRealHistoryDetail,
      realWorkspaces: allWorkspaces,
      signUpReal,
      logInReal,
      logOutReal,
      refreshSession: () => initializeFromSession(),
      createWorkspaceReal,
      switchWorkspace,
      runRealAnalysis,
    };
  }, [
    auth,
    onboarding,
    states,
    sessionLoaded,
    sessionError,
    workspace,
    allWorkspaces,
    properties,
    statuses,
    errors,
    notices,
    realHistory,
    realHistoryStatus,
    realHistoryError,
    historyDetail,
    actionPending,
    actionError,
    loadProperty,
    loadHistory,
    switchToProperty,
    refreshFix,
    runAction,
    logOutReal,
    signUpReal,
    logInReal,
    createWorkspaceReal,
    switchWorkspace,
    loadRealHistoryDetail,
    runRealAnalysis,
    initializeFromSession,
  ]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function SessionProvider({ children, mode = "mock" }: { children: ReactNode; mode?: ProviderMode }) {
  if (mode === "real") return <RealSessionProvider>{children}</RealSessionProvider>;
  return <MockSessionProvider>{children}</MockSessionProvider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
