/**
 * API PROVIDER TESTS — Prompt 13 §14 (mocked fetch; no Google credentials).
 *
 * Covers: GET recommendation, GET fix, CSRF retrieval, x-csrf-token on
 * POST, credentials:include, 401/403/404/429/502 mapping,
 * insufficient/stale/unavailable mapping, measurement_pending, fix
 * lifecycle calls (review/apply/dismiss/acknowledge/check), token hygiene,
 * localStorage hygiene, and session-derived workspace context.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createApiProvider,
  fetchSessionContext,
  mapApiError,
  resetCsrfToken,
  _internal,
} from "../api-provider.ts";
import { isMeasurementPending, pendingNoticeFor, MEASUREMENT_PENDING_COPY } from "../real-state.ts";

interface CapturedCall {
  url: string;
  init: RequestInit;
}

let calls: CapturedCall[] = [];
type RouteHandler = (url: string, init: RequestInit) => { status: number; body: unknown };
let handler: RouteHandler = () => ({ status: 404, body: { code: "PROPERTY_NOT_FOUND", message: "missing" } });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  calls = [];
  resetCsrfToken();
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const initValue = init ?? {};
    calls.push({ url: String(url), init: initValue });
    const route = handler(String(url), initValue);
    return jsonResponse(route.status, route.body);
  }) as typeof fetch;
});

const WORKSPACE_ID = "ws_123";
const PROPERTY_ID = "prop_456";
const FIX_ID = "fix_789";

function csrfRoute() {
  handler = (url) => {
    if (url.endsWith("/auth/csrf")) return { status: 200, body: { csrfToken: "csrf-test-token" } };
    return { status: 404, body: { code: "PROPERTY_NOT_FOUND", message: "missing" } };
  };
}

function backendRecommendation(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec_1",
    page: "/pricing",
    signal: "ctr-below-expected",
    finding: "Impressions strong, clicks weak.",
    interpretation: "May indicate a title mismatch.",
    recommendedAction: "Rewrite the page title.",
    rationale: "CTR trails the baseline at this position.",
    snapshot: {
      meta: {
        source: { id: "google-search-console", label: "Google Search Console" },
        property: { id: PROPERTY_ID, name: "example.com", type: "domain" },
        period: { start: "2026-08-01T00:00:00.000Z", end: "2026-08-29T00:00:00.000Z", label: "Last 28 days" },
        dataThrough: "2026-08-29T00:00:00.000Z",
        retrievedAt: "2026-08-30T00:00:00.000Z",
        freshness: "fresh",
        quality: "complete",
        limitations: [],
      },
      page: { page: "/pricing", clicks: 74, impressions: 2840, ctr: 0.026, position: 4.2 },
      queries: [{ query: "pricing plans", clicks: 31, impressions: 1180, ctr: 0.026, position: 4.1 }],
    },
    evidence: { rows: [{ query: "pricing plans", clicks: 31, impressions: 1180, ctr: "2.6%", position: "4.1" }] },
    limitations: [],
    ...overrides,
  };
}

test("1. Api provider GET recommendation returns the backend's ONE recommendation with evidence", async () => {
  handler = (url) => {
    if (url.includes(`/properties/${PROPERTY_ID}/recommendation`)) {
      return { status: 200, body: { status: "recommendation-available", recommendation: backendRecommendation() } };
    }
    return { status: 404, body: {} };
  };
  const api = createApiProvider(WORKSPACE_ID);
  const result = await api.getRecommendationResult(PROPERTY_ID);
  assert.equal(result.status, "recommendation-available");
  assert.ok(result.recommendation);
  assert.equal(result.recommendation.page, "/pricing");
  assert.equal(result.recommendation.evidence.rows.length, 1);
  assert.equal(result.recommendation.snapshot.meta.source.id, "google-search-console");
  const getCall = calls.find((c) => c.url.includes("/recommendation"));
  assert.ok(getCall, "expected a GET to the recommendation endpoint");
  assert.equal(getCall.init.method ?? "GET", "GET");
});

test("2. Api provider GET fix returns the backend Fix mapped to a ProductFix", async () => {
  handler = (url) => {
    if (url.includes(`/properties/${PROPERTY_ID}/fix`)) {
      return {
        status: 200,
        body: {
          fix: {
            id: FIX_ID,
            page: "/pricing",
            status: "applied",
            baseline: { clicks: 74, ctr: "2.6%", position: 4.2, capturedAt: "2026-08-30T00:00:00.000Z" },
            appliedAt: "2026-08-30T00:00:00.000Z",
            expectedMeasurementDate: "2026-09-13T00:00:00.000Z",
            measurementWindowDays: 14,
            outcome: null,
            recommendation: backendRecommendation(),
          },
        },
      };
    }
    return { status: 404, body: {} };
  };
  const api = createApiProvider(WORKSPACE_ID);
  const { fix } = await api.getFix(PROPERTY_ID);
  assert.ok(fix);
  assert.equal(fix.id, FIX_ID);
  assert.equal(fix.status, "applied");
  assert.equal(fix.baseline?.clicks, 74);
  assert.equal(fix.measurementWindowDays, 14);
  assert.equal(fix.outcome, undefined);
});

test("3. CSRF token is retrieved from GET /auth/csrf", async () => {
  csrfRoute();
  const token = await _internal.ensureCsrfToken();
  assert.equal(token, "csrf-test-token");
  const csrfCall = calls.find((c) => c.url.endsWith("/auth/csrf"));
  assert.ok(csrfCall, "expected a call to /auth/csrf");
});

test("4. POST sends x-csrf-token header", async () => {
  handler = (url) => {
    if (url.endsWith("/auth/csrf")) return { status: 200, body: { csrfToken: "csrf-abc" } };
    if (url.includes("/review")) return { status: 200, body: { fix: { id: FIX_ID } } };
    return { status: 404, body: {} };
  };
  const api = createApiProvider(WORKSPACE_ID);
  await api.reviewFix(PROPERTY_ID, FIX_ID);
  const post = calls.find((c) => c.url.includes("/review"));
  assert.ok(post);
  const headers = post.init.headers as Record<string, string>;
  assert.equal(headers["x-csrf-token"], "csrf-abc");
});

test("5. every request uses credentials: include", async () => {
  handler = (url) => {
    if (url.endsWith("/auth/csrf")) return { status: 200, body: { csrfToken: "t" } };
    if (url.endsWith("/auth/me")) return { status: 200, body: { user: { id: "u", email: "e" }, workspaces: [] } };
    if (url.includes("/recommendation")) return { status: 200, body: { status: "no-signal" } };
    if (url.includes("/review")) return { status: 200, body: { fix: {} } };
    return { status: 404, body: {} };
  };
  const api = createApiProvider(WORKSPACE_ID);
  await fetchSessionContext();
  await api.getRecommendationResult(PROPERTY_ID);
  await api.reviewFix(PROPERTY_ID, FIX_ID);
  assert.ok(calls.length >= 3);
  for (const call of calls) {
    assert.equal(call.init.credentials, "include", `missing credentials:include for ${call.url}`);
  }
});

test("expired CSRF token is refreshed once and the POST retried", async () => {
  let reviews = 0;
  handler = (url) => {
    if (url.endsWith("/auth/csrf")) return { status: 200, body: { csrfToken: "csrf-fresh" } };
    if (url.includes("/apply")) {
      reviews++;
      if (reviews === 1) return { status: 403, body: { code: "FORBIDDEN", message: "Invalid CSRF token." } };
      return { status: 200, body: { fix: { id: FIX_ID } } };
    }
    return { status: 404, body: {} };
  };
  const api = createApiProvider(WORKSPACE_ID);
  await api.applyFix(PROPERTY_ID, FIX_ID);
  assert.equal(reviews, 2, "expected one retry after CSRF refresh");
  const retry = calls.filter((c) => c.url.includes("/apply"))[1];
  assert.equal((retry!.init.headers as Record<string, string>)["x-csrf-token"], "csrf-fresh");
});

test("6. 401 maps to AUTH_REQUIRED", () => {
  const error = mapApiError(401, { code: "AUTH_REQUIRED", message: "Sign in again." });
  assert.equal(error.code, "AUTH_REQUIRED");
});

test("7. 403 maps to PERMISSION_DENIED (workspace/CSRF problem)", () => {
  const error = mapApiError(403, { code: "PERMISSION_DENIED", message: "No access." });
  assert.equal(error.code, "PERMISSION_DENIED");
});

test("8. 404 maps to unavailable/not-found (PROPERTY_NOT_FOUND, snapshot DATA_UNAVAILABLE → NO_DATA)", () => {
  assert.equal(mapApiError(404, { code: "PROPERTY_NOT_FOUND", message: "x" }).code, "PROPERTY_NOT_FOUND");
  assert.equal(mapApiError(404, { code: "DATA_UNAVAILABLE", message: "nothing yet" }).code, "NO_DATA");
});

test("9. 429 maps to RATE_LIMITED", () => {
  assert.equal(mapApiError(429, { code: "RATE_LIMITED", message: "slow down" }).code, "RATE_LIMITED");
});

test("10. 502/upstream maps to UPSTREAM_ERROR", () => {
  assert.equal(mapApiError(502, { code: "UPSTREAM_ERROR", message: "bad gateway" }).code, "UPSTREAM_ERROR");
  assert.equal(mapApiError(503, {}).code, "UPSTREAM_ERROR");
});

test("validation/internal errors map to an appropriate error state, never success", () => {
  assert.equal(mapApiError(400, { message: "bad input" }).code, "UNKNOWN_ERROR");
  assert.equal(mapApiError(500, {}).code, "UNKNOWN_ERROR");
});

test("11/12/13. insufficient-data, stale-data, and unavailable pass through honestly (never collapsed)", async () => {
  const cases: Array<{ body: unknown; expected: string }> = [
    { body: { status: "insufficient-data", meta: { quality: "missing" } }, expected: "insufficient-data" },
    { body: { status: "stale-data", meta: { freshness: "stale" } }, expected: "stale-data" },
    { body: { status: "unavailable" }, expected: "unavailable" },
    { body: { status: "no-signal" }, expected: "no-signal" },
  ];
  const api = createApiProvider(WORKSPACE_ID);
  for (const { body, expected } of cases) {
    handler = (url) => {
      if (url.includes("/recommendation")) return { status: 200, body };
      return { status: 404, body: {} };
    };
    const result = await api.getRecommendationResult(PROPERTY_ID);
    assert.equal(result.status, expected);
    assert.equal(result.recommendation, undefined, `${expected} must never carry a fabricated recommendation`);
  }
});

test("21. Fix apply calls the backend POST endpoint", async () => {
  csrfRoute();
  handler = (url) => {
    if (url.endsWith("/auth/csrf")) return { status: 200, body: { csrfToken: "t" } };
    if (url.includes(`/fix/${FIX_ID}/apply`)) return { status: 200, body: { fix: { id: FIX_ID } } };
    return { status: 404, body: {} };
  };
  const api = createApiProvider(WORKSPACE_ID);
  await api.applyFix(PROPERTY_ID, FIX_ID);
  const call = calls.find((c) => c.url.includes("/apply"));
  assert.ok(call);
  assert.equal(call.init.method, "POST");
  assert.ok(call.url.includes(`/workspaces/${WORKSPACE_ID}/properties/${PROPERTY_ID}/fix/${FIX_ID}/apply`));
});

test("22. Fix dismiss calls the backend POST endpoint with the reason", async () => {
  handler = (url) => {
    if (url.endsWith("/auth/csrf")) return { status: 200, body: { csrfToken: "t" } };
    if (url.includes(`/fix/${FIX_ID}/dismiss`)) return { status: 200, body: { fix: { id: FIX_ID } } };
    return { status: 404, body: {} };
  };
  const api = createApiProvider(WORKSPACE_ID);
  await api.dismissFix(PROPERTY_ID, FIX_ID, "not-applicable");
  const call = calls.find((c) => c.url.includes("/dismiss"));
  assert.ok(call);
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.body, JSON.stringify({ reason: "not-applicable" }));
});

test("23. Fix review calls the backend POST endpoint", async () => {
  handler = (url) => {
    if (url.endsWith("/auth/csrf")) return { status: 200, body: { csrfToken: "t" } };
    if (url.includes(`/fix/${FIX_ID}/review`)) return { status: 200, body: { fix: { id: FIX_ID } } };
    return { status: 404, body: {} };
  };
  const api = createApiProvider(WORKSPACE_ID);
  await api.reviewFix(PROPERTY_ID, FIX_ID);
  const call = calls.find((c) => c.url.includes("/review"));
  assert.ok(call);
  assert.equal(call.init.method, "POST");
});

test("24. Fix acknowledge calls the backend POST endpoint", async () => {
  handler = (url) => {
    if (url.endsWith("/auth/csrf")) return { status: 200, body: { csrfToken: "t" } };
    if (url.includes(`/fix/${FIX_ID}/acknowledge`)) return { status: 200, body: { ok: true } };
    return { status: 404, body: {} };
  };
  const api = createApiProvider(WORKSPACE_ID);
  await api.acknowledgeFix(PROPERTY_ID, FIX_ID);
  const call = calls.find((c) => c.url.includes("/acknowledge"));
  assert.ok(call);
  assert.equal(call.init.method, "POST");
});

test("14/25. Fix check surfaces measurement_pending honestly (no fake outcome)", async () => {
  handler = (url) => {
    if (url.endsWith("/auth/csrf")) return { status: 200, body: { csrfToken: "t" } };
    if (url.includes(`/fix/${FIX_ID}/check`)) {
      return {
        status: 200,
        body: { status: "measurement_pending", message: "Measurement window not yet reached — check back after the 14-day window." },
      };
    }
    return { status: 404, body: {} };
  };
  const api = createApiProvider(WORKSPACE_ID);
  const result = await api.checkFix(PROPERTY_ID, FIX_ID);
  assert.ok(isMeasurementPending(result));
  const notice = pendingNoticeFor(result);
  assert.ok(notice.includes(MEASUREMENT_PENDING_COPY));
  assert.equal(result.outcome, undefined, "pending must not include an outcome");
});

test("26. no Google token appears anywhere in frontend-mapped state", async () => {
  handler = (url) => {
    if (url.includes(`/properties/${PROPERTY_ID}/fix`)) {
      return {
        status: 200,
        body: {
          fix: {
            id: FIX_ID,
            page: "/pricing",
            status: "available",
            measurementWindowDays: 14,
            outcome: null,
            recommendation: backendRecommendation(),
            // Backend must never send these, but if it did, mapping must drop them.
            encryptedRefreshToken: " ENC-BLOB ",
            access_token: "ya29.gl-FAKE-ACCESS-TOKEN",
            refresh_token: "1//FAKE-REFRESH-TOKEN",
          },
        },
      };
    }
    return { status: 404, body: {} };
  };
  const api = createApiProvider(WORKSPACE_ID);
  const { fix } = await api.getFix(PROPERTY_ID);
  assert.ok(fix);
  const serialized = JSON.stringify(fix);
  assert.ok(!serialized.includes("ya29."), "access token leaked into state");
  assert.ok(!serialized.includes("FAKE-REFRESH-TOKEN"), "refresh token leaked into state");
  assert.ok(!serialized.includes("ENC-BLOB"), "encrypted token leaked into state");
  assert.ok(!serialized.toLowerCase().includes("refresh_token"), "token field name leaked into state");
});

test("27. no session ID or token is stored in localStorage by the provider", async () => {
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
      if (url.endsWith("/auth/csrf")) return { status: 200, body: { csrfToken: "csrf-secret-value" } };
      if (url.includes("/recommendation")) {
        return { status: 200, body: { status: "recommendation-available", recommendation: backendRecommendation() } };
      }
      if (url.includes(`/fix/${FIX_ID}/apply`)) return { status: 200, body: { fix: { id: FIX_ID } } };
      return { status: 404, body: {} };
    };
    const api = createApiProvider(WORKSPACE_ID);
    await api.getRecommendationResult(PROPERTY_ID);
    await api.applyFix(PROPERTY_ID, FIX_ID);
    assert.deepEqual(touched, [], `provider touched client storage: ${touched.join(", ")}`);
  } finally {
    delete (globalThis as unknown as { window?: unknown }).window;
  }
});

test("28. workspace context comes from the authenticated session (/auth/me)", async () => {
  handler = (url) => {
    if (url.endsWith("/auth/me")) {
      return {
        status: 200,
        body: { user: { id: "user_1", email: "owner@example.com" }, workspaces: [{ id: "ws_session", name: "Acme", plan: "solo" }] },
      };
    }
    if (url.includes("/recommendation")) return { status: 200, body: { status: "no-signal" } };
    return { status: 404, body: {} };
  };
  const session = await fetchSessionContext();
  assert.equal(session.workspaces[0]!.id, "ws_session");
  // The provider is constructed with the session workspace — requests are
  // scoped to it, and a tampered id cannot leak another workspace's data
  // because the backend re-checks membership (403/404 here surface as errors).
  const api = createApiProvider(session.workspaces[0]!.id);
  await api.getRecommendationResult(PROPERTY_ID);
  const call = calls.find((c) => c.url.includes("/recommendation"));
  assert.ok(call);
  assert.ok(call.url.includes("/workspaces/ws_session/properties/"), `wrong workspace scope: ${call.url}`);
  assert.ok(!call.url.includes("ws_attacker"));
});
