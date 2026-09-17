/**
 * REAL AUTH + HISTORY TESTS — required frontend items 16–26 (mocked fetch;
 * no Google credentials, no real backend).
 *
 * Covers: real History list/detail/empty mapping, mock History unchanged,
 * real signup/login/logout, session refresh via /auth/me, localStorage
 * hygiene, session-derived workspace context, and property-switch clearing.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createApiProvider,
  fetchSessionContext,
  getApiBase,
  mapAuthErrorToForm,
  mapBackendHistoryItem,
  resetCsrfToken,
} from "../api-provider.ts";
import {
  signUpApi,
  logInApi,
  logOutApi,
  createWorkspaceApi,
  fetchConnectionStatus,
} from "../api-provider.ts";
import {
  backendRecommendationToOnboardingFix,
  discardStateForPropertySwitch,
  filterHistoryByProperty,
  resolveHistoryView,
} from "../real-state.ts";
import { seedHistory } from "../../mock/product-service.ts";
import type { BackendRecommendation } from "../api-provider.ts";

let calls: { url: string; init: RequestInit }[] = [];
type RouteHandler = (url: string, init: RequestInit) => { status: number; body: unknown };
let handler: RouteHandler = () => ({ status: 404, body: {} });

beforeEach(() => {
  calls = [];
  resetCsrfToken();
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const initValue = init ?? {};
    calls.push({ url: String(url), init: initValue });
    const route = handler(String(url), initValue);
    return new Response(JSON.stringify(route.body), {
      status: route.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
});

const WORKSPACE_ID = "ws_123";

function sampleProductFix(overrides: Record<string, unknown> = {}) {
  return {
    id: "fix_1",
    page: "/pricing",
    clicks: 74,
    clicksDeltaPct: -34,
    impressions: 2840,
    ctr: "2.6%",
    position: 4.2,
    positionBaseline: 1.8,
    finding: "Impressions strong, clicks weak.",
    interpretation: "May indicate a title mismatch.",
    recommendedChange: "Rewrite the page title.",
    why: "CTR trails the baseline.",
    evidence: { rows: [{ query: "pricing plans", clicks: 31, impressions: 1180, ctr: "2.6%", position: "4.1" }] },
    dataMeta: {
      source: { id: "google-search-console", label: "Google Search Console" },
      property: { id: "prop_1", name: "example.com", type: "domain" },
      period: { start: "2026-08-01T00:00:00.000Z", end: "2026-08-29T00:00:00.000Z", label: "Last 28 days" },
      dataThrough: "2026-08-29T00:00:00.000Z",
      retrievedAt: "2026-08-30T00:00:00.000Z",
      freshness: "fresh",
      quality: "complete",
      limitations: [],
    },
    status: "applied",
    measurementWindowDays: 14,
    appliedAt: "2026-08-30T00:00:00.000Z",
    ...overrides,
  };
}

function sampleHistoryItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "fix_1",
    propertyId: "prop_1",
    propertyName: "example.com",
    fix: sampleProductFix(),
    page: "/pricing",
    recommendedChange: "Rewrite the page title.",
    status: "measured",
    appliedAt: "2026-08-30T00:00:00.000Z",
    outcome: {
      status: "positive-change",
      before: { clicks: 74, ctr: "2.6%", position: 4.2 },
      after: { clicks: 96, ctr: "3.4%", position: 3.1 },
      measuredAt: "2026-09-13T00:00:00.000Z",
    },
    ...overrides,
  };
}

test("16. real mode History list fetches backend items (workspace history, mapped)", async () => {
  handler = (url) => {
    if (url.includes(`/workspaces/${WORKSPACE_ID}/history`)) {
      return { status: 200, body: { items: [sampleHistoryItem()], total: 1, limit: 25, offset: 0 } };
    }
    return { status: 404, body: {} };
  };
  const api = createApiProvider(WORKSPACE_ID);
  const { items, total } = await api.listHistory();
  assert.equal(total, 1);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.id, "fix_1");
  assert.equal(items[0]!.status, "measured");
  assert.equal(items[0]!.outcome?.status, "positive-change");
  assert.equal(items[0]!.fix.dataMeta.property.id, "prop_1");
  const call = calls.find((c) => c.url.includes("/history"));
  assert.ok(call);
  assert.equal(call.init.credentials, "include");
});

test("16b. history list sends pagination params and drops malformed rows", async () => {
  handler = (url) => {
    if (url.includes("/history")) {
      assert.ok(url.includes("limit=1"), `expected limit param in ${url}`);
      assert.ok(url.includes("offset=5"), `expected offset param in ${url}`);
      return { status: 200, body: { items: [sampleHistoryItem(), { id: 42, status: "bogus" }], total: 9 } };
    }
    return { status: 404, body: {} };
  };
  const api = createApiProvider(WORKSPACE_ID);
  const { items, total } = await api.listHistory({ limit: 1, offset: 5 });
  assert.equal(total, 9);
  assert.equal(items.length, 1, "malformed rows must be dropped, not crash the list");
});

test("17. real mode History detail fetches the backend item (not stale local state)", async () => {
  handler = (url) => {
    if (url.includes(`/history/fix_1`)) {
      return { status: 200, body: { item: sampleHistoryItem() } };
    }
    return { status: 404, body: {} };
  };
  const api = createApiProvider(WORKSPACE_ID);
  const item = await api.getHistoryDetail("fix_1");
  assert.equal(item.id, "fix_1");
  assert.ok(item.fix.evidence.rows.length > 0, "detail must carry evidence");
  assert.ok(item.fix.dataMeta, "detail must carry provenance");
  assert.equal(item.outcome?.after?.clicks, 96);
});

test("17b. history detail 404 maps to not-found (never leaks)", async () => {
  handler = () => ({ status: 404, body: { code: "PROPERTY_NOT_FOUND", message: "nope" } });
  const api = createApiProvider(WORKSPACE_ID);
  await assert.rejects(api.getHistoryDetail("fix_other_ws"), (error: unknown) => {
    return (error as { code?: string }).code === "PROPERTY_NOT_FOUND";
  });
});

test("8-map. permission/auth errors are never converted into empty history", async () => {
  for (const [status, code] of [[401, "AUTH_REQUIRED"], [403, "PERMISSION_DENIED"], [429, "RATE_LIMITED"]] as const) {
    handler = () => ({ status, body: { code, message: "denied" } });
    const api = createApiProvider(WORKSPACE_ID);
    await assert.rejects(api.listHistory(), (error: unknown) => (error as { code?: string }).code === code);
  }
});

test("18. real mode empty history resolves to the honest empty view", async () => {
  handler = (url) => {
    if (url.includes("/history")) return { status: 200, body: { items: [], total: 0 } };
    return { status: 404, body: {} };
  };
  const api = createApiProvider(WORKSPACE_ID);
  const { items } = await api.listHistory();
  const view = resolveHistoryView("ready", null, items);
  assert.equal(view.kind, "empty");
  assert.deepEqual(view.items, []);

  const loading = resolveHistoryView("loading", null, []);
  assert.equal(loading.kind, "loading");
  const errored = resolveHistoryView("error", { code: "UPSTREAM_ERROR", message: "x" }, []);
  assert.equal(errored.kind, "error");
});

test("19. mock mode History remains unchanged (seeded demo history intact)", () => {
  const history = seedHistory("example.com");
  assert.equal(history.length, 2);
  assert.ok(history.every((h) => h.fix.dataMeta.property.id === "example.com"));
  assert.ok(history.some((h) => h.status === "measured"));
});

test("history is filtered to the active property (workspace list, property screens)", () => {
  const mine = sampleHistoryItem({ id: "a" });
  const otherFix = sampleProductFix({ id: "b", dataMeta: { ...sampleProductFix().dataMeta, property: { id: "prop_2", name: "other.com", type: "domain" } } });
  const other = sampleHistoryItem({ id: "b", fix: otherFix });
  const mapped = [mine, other].map((raw) => mapBackendHistoryItem(raw as never)).filter((x) => x !== null);
  const filtered = filterHistoryByProperty(mapped, "prop_1");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.id, "a");
});

test("20. real signup posts to the backend and returns user + workspace", async () => {
  handler = (url, init) => {
    if (url.endsWith("/auth/sign-up")) {
      assert.equal(init.method, "POST");
      const body = JSON.parse(String(init.body));
      assert.equal(body.email, "owner@example.com");
      return { status: 201, body: { user: { id: "u1", email: "owner@example.com" }, workspace: { id: "ws_new", name: "Acme", plan: "solo" } } };
    }
    return { status: 404, body: {} };
  };
  const result = await signUpApi("owner@example.com", "Renko123!");
  assert.equal(result.user.email, "owner@example.com");
  assert.equal(result.workspace?.id, "ws_new");
  const call = calls.find((c) => c.url.endsWith("/auth/sign-up"));
  assert.equal(call!.init.credentials, "include");
});

test("20b. signup conflict maps to the email-exists form error", async () => {
  handler = () => ({ status: 409, body: { code: "EMAIL_EXISTS", message: "This email is already registered. Log in instead." } });
  const result = await signUpApi("exists@example.com", "Renko123!").then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, ...mapAuthErrorToForm(error) }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorCode, "email-exists");
});

test("21. real login posts to the backend and returns user + workspaces", async () => {
  handler = (url, init) => {
    if (url.endsWith("/auth/log-in")) {
      assert.equal(init.method, "POST");
      return { status: 200, body: { user: { id: "u1", email: "owner@example.com" }, workspaces: [{ id: "ws_1", name: "Acme", plan: "solo" }] } };
    }
    return { status: 404, body: {} };
  };
  const result = await logInApi("owner@example.com", "Renko123!");
  assert.equal(result.user.id, "u1");
  assert.equal(result.workspaces?.[0]!.id, "ws_1");
});

test("21b. invalid credentials map to the form error (never a crash)", async () => {
  handler = () => ({ status: 401, body: { code: "INVALID_CREDENTIALS", message: "Those credentials don't match our records." } });
  const outcome = await logInApi("owner@example.com", "wrong").then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, ...mapAuthErrorToForm(error) }),
  );
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.errorCode, "invalid-credentials");
});

test("22. auth refresh goes through /auth/me (server session is the source of truth)", async () => {
  handler = (url) => {
    if (url.endsWith("/auth/me")) {
      return { status: 200, body: { user: { id: "u1", email: "owner@example.com" }, workspaces: [{ id: "ws_1", name: "Acme", plan: "solo" }] } };
    }
    return { status: 404, body: {} };
  };
  const session = await fetchSessionContext();
  assert.equal(session.user.email, "owner@example.com");
  assert.equal(session.workspaces[0]!.id, "ws_1");
});

test("23. logout calls the backend with CSRF + credentials", async () => {
  handler = (url, init) => {
    if (url.endsWith("/auth/csrf")) return { status: 200, body: { csrfToken: "csrf-1" } };
    if (url.endsWith("/auth/log-out")) {
      assert.equal(init.method, "POST");
      assert.equal((init.headers as Record<string, string>)["x-csrf-token"], "csrf-1");
      return { status: 200, body: { ok: true } };
    }
    return { status: 404, body: {} };
  };
  await logOutApi();
  assert.ok(calls.some((c) => c.url.endsWith("/auth/log-out")));
});

test("create workspace + connection status use the authenticated session", async () => {
  handler = (url, init) => {
    if (url.endsWith("/auth/csrf")) return { status: 200, body: { csrfToken: "csrf-1" } };
    if (url.endsWith("/workspaces") && init.method === "POST") {
      return { status: 201, body: { workspace: { id: "ws_2", name: "Beta", plan: "solo" } } };
    }
    if (url.includes("/connections/status")) {
      return { status: 200, body: { connected: true, status: "connected", googleAccountEmail: "owner@gmail.com", scopes: [] } };
    }
    return { status: 404, body: {} };
  };
  const workspace = await createWorkspaceApi("Beta");
  assert.equal(workspace.id, "ws_2");
  const status = await fetchConnectionStatus("ws_2");
  assert.equal(status.connected, true);
  assert.equal(status.googleAccountEmail, "owner@gmail.com");
});

test("24. no auth/session/Google token in localStorage or returned auth state", async () => {
  const touched: string[] = [];
  (globalThis as unknown as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => {
        touched.push(`get:${key}`);
        return null;
      },
      setItem: (key: string) => {
        touched.push(`set:${key}`);
      },
      removeItem: (key: string) => {
        touched.push(`remove:${key}`);
      },
    },
  };
  try {
    handler = (url) => {
      if (url.endsWith("/auth/log-in")) {
        return {
          status: 200,
          body: {
            user: { id: "u1", email: "owner@example.com" },
            workspaces: [{ id: "ws_1", name: "Acme", plan: "solo" }],
            // Even if the backend ever included these, the client must not retain them.
            access_token: "ya29.gl-FAKE",
            refresh_token: "1//FAKE",
            sessionId: "sess_FAKE",
          },
        };
      }
      if (url.endsWith("/auth/me")) {
        return { status: 200, body: { user: { id: "u1", email: "owner@example.com" }, workspaces: [] } };
      }
      return { status: 404, body: {} };
    };
    const login = await logInApi("owner@example.com", "Renko123!");
    assert.deepEqual(Object.keys(login).sort(), ["user", "workspaces"]);
    const serialized = JSON.stringify(login);
    assert.ok(!serialized.includes("ya29."));
    assert.ok(!serialized.includes("FAKE"));
    assert.ok(!serialized.includes("sess_"));
    await fetchSessionContext();
    assert.deepEqual(touched, [], `client storage touched: ${touched.join(", ")}`);
    assert.ok(!getApiBase().includes("token"));
  } finally {
    delete (globalThis as unknown as { window?: unknown }).window;
  }
});

test("25. workspace context comes from /auth/me (history + properties scoped to it)", async () => {
  handler = (url) => {
    if (url.endsWith("/auth/me")) {
      return { status: 200, body: { user: { id: "u1", email: "e" }, workspaces: [{ id: "ws_live", name: "Live", plan: "solo" }] } };
    }
    if (url.includes("/history")) return { status: 200, body: { items: [], total: 0 } };
    if (url.endsWith("/properties")) return { status: 200, body: { properties: [] } };
    return { status: 404, body: {} };
  };
  const session = await fetchSessionContext();
  const api = createApiProvider(session.workspaces[0]!.id);
  await api.listHistory();
  await api.listProperties();
  const historyCall = calls.find((c) => c.url.includes("/history"));
  const propsCall = calls.find((c) => c.url.endsWith("/properties"));
  assert.ok(historyCall!.url.includes("/workspaces/ws_live/history"));
  assert.ok(propsCall!.url.includes("/workspaces/ws_live/properties"));
});

test("26. property/workspace switch clears stale recommendation/fix/history state", () => {
  const before = {
    states: { prop_old: { currentFix: sampleProductFix(), history: [], noFixReason: "no-fix", lastCheckedAt: "", nextCheckAt: "", lastSuccessfulDataAt: "" } as never },
    statuses: { prop_old: "ready" as const },
    errors: { prop_old: null },
    notices: { prop_old: "pending" },
  };
  const after = discardStateForPropertySwitch(before);
  assert.deepEqual(after, { states: {}, statuses: {}, errors: {}, notices: {} });
});

test("backend recommendation reshapes into the onboarding fix without new facts", () => {
  const recommendation = {
    id: "rec_1",
    page: "/pricing",
    signal: "ctr-below-expected",
    finding: "Impressions strong, clicks weak.",
    interpretation: "May indicate a title mismatch.",
    recommendedAction: "Rewrite the page title.",
    rationale: "CTR trails the baseline.",
    snapshot: {
      meta: sampleProductFix().dataMeta,
      page: { page: "/pricing", clicks: 74, impressions: 2840, ctr: 0.026, position: 4.2 },
      comparisonPage: { page: "/pricing", clicks: 100, impressions: 2800, ctr: 0.036, position: 3.1 },
      queries: [],
    },
    evidence: { rows: [{ query: "pricing plans", clicks: 31, impressions: 1180, ctr: "2.6%", position: "4.1" }] },
    limitations: [],
  } as BackendRecommendation;
  const fix = backendRecommendationToOnboardingFix(recommendation);
  assert.equal(fix.page, "/pricing");
  assert.equal(fix.clicks, 74);
  assert.equal(fix.recommendedChange, "Rewrite the page title.");
  assert.equal(fix.evidence.rows.length, 1);
  assert.equal(fix.evidence.windowLabel, "Last 28 days");
  assert.equal(fix.ctr, "2.6%");
});
