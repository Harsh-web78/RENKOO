/**
 * RENKO production smoke test (Prompt 7 §18).
 *
 * Covers: 1 health · 2 auth/session · 3 workspace · 4 property · 5 recommendation
 * · 6 fix · 7 apply · 8 measurement status · 9 history.
 *
 * Usage:
 *   node scripts/smoke-test.mjs
 *   API_BASE=https://api.renkoo.online/api/v1 node scripts/smoke-test.mjs
 *
 * Config (environment only, never hardcoded):
 *   API_BASE   API origin + /api/v1 (default http://localhost:3000/api/v1)
 *   SMOKE_EMAIL / SMOKE_PASSWORD  credentials for a throwaway account
 *   (defaults create a random @smoke.local address; existing accounts are
 *   NOT supported — sign-up must succeed for isolation).
 *
 * Google: NO fake Google success is asserted. Ingestion/sync steps run only
 * when SMOKE_RUN_GOOGLE=1 AND live credentials exist server-side; otherwise
 * they are reported SKIPPED (not passed). Live tokens are never printed.
 */

const API_BASE = process.env.API_BASE ?? "http://localhost:3000/api/v1";
const RUN_GOOGLE = process.env.SMOKE_RUN_GOOGLE === "1";
const email = process.env.SMOKE_EMAIL ?? `smoke-${Date.now()}@smoke.local`;
const password = process.env.SMOKE_PASSWORD ?? "Smoke123!Smoke123!";

let cookies = "";
let passed = 0;
let failed = 0;
const skipped = [];

function storeCookies(res) {
  const set = res.headers.getSetCookie?.() ?? [];
  for (const c of set) {
    const pair = c.split(";")[0];
    const name = pair.split("=")[0];
    cookies = cookies
      .split(/; /)
      .filter((p) => !p.startsWith(`${name}=`))
      .concat([pair])
      .filter(Boolean)
      .join("; ");
  }
}

async function req(method, path, body, { csrf = null } = {}) {
  const headers = { "content-type": "application/json" };
  if (cookies) headers.cookie = cookies;
  if (csrf) headers["x-csrf-token"] = csrf;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  storeCookies(res);
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, data };
}

function check(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name} ${detail}`.trim());
  }
}

async function main() {
  console.log(`Smoke target: ${API_BASE}`);

  // 1. Health
  const health = await req("GET", "/health");
  check("1. health liveness ok", health.status === 200 && health.data?.status === "ok", JSON.stringify(health.data)?.slice(0, 200));
  const ready = await req("GET", "/health/ready");
  check(
    "1b. readiness reports db state",
    ready.status === 200 && ["ok", "degraded"].includes(ready.data?.status) && ["ok", "down"].includes(ready.data?.db),
    JSON.stringify(ready.data)?.slice(0, 200),
  );

  // 2. Auth/session
  const signup = await req("POST", "/auth/sign-up", { email, password });
  check("2. sign-up 201 + workspace", signup.status === 201 && !!signup.data?.workspace?.id, `status=${signup.status}`);
  const workspaceId = signup.data?.workspace?.id;
  if (!workspaceId) {
    console.log(`RESULT: ${passed} passed, ${failed} failed, ${skipped.length} skipped`);
    process.exit(1);
  }
  const me = await req("GET", "/auth/me");
  check("2b. session persists via cookie", me.status === 200 && !!me.data?.user?.id, `status=${me.status}`);
  const csrfRes = await req("GET", "/auth/csrf");
  const csrf = csrfRes.data?.csrfToken ?? null;
  check("2c. csrf token issued", csrfRes.status === 200 && typeof csrf === "string", `status=${csrfRes.status}`);

  // 3. Workspace
  const ws = await req("GET", "/workspaces");
  check("3. workspace listed", ws.status === 200 && Array.isArray(ws.data?.workspaces), `status=${ws.status}`);

  // 4. Property (+ optional Google-gated sync)
  if (!RUN_GOOGLE) {
    skipped.push("4. property sync (needs SMOKE_RUN_GOOGLE=1 with live server credentials)");
    skipped.push("5. recommendation (needs ingested property)");
    skipped.push("6-9. fix/apply/measurement/history (needs recommendation)");
    console.log(`RESULT: ${passed} passed, ${failed} failed, ${skipped.length} skipped`);
    for (const s of skipped) console.log(`SKIP ${s}`);
    process.exit(failed === 0 ? 0 : 1);
  }
  const sync = await req("POST", `/workspaces/${workspaceId}/properties/sync`, {}, { csrf });
  check("4. property sync succeeds with live Google", sync.status === 201, `status=${sync.status} ${JSON.stringify(sync.data)?.slice(0, 160)}`);
  const props = await req("GET", `/workspaces/${workspaceId}/properties`);
  const propertyId = props.data?.properties?.[0]?.id;
  check("4b. property listed", props.status === 200 && !!propertyId, `status=${props.status}`);
  if (!propertyId) {
    console.log(`RESULT: ${passed} passed, ${failed} failed, ${skipped.length} skipped`);
    process.exit(1);
  }

  // 5-9. Full lifecycle (live data only — never asserted with mocks)
  const ingest = await req("POST", `/workspaces/${workspaceId}/properties/${propertyId}/ingest`, {}, { csrf });
  check("5. ingest 201", ingest.status === 201, `status=${ingest.status}`);
  const rec = await req("GET", `/workspaces/${workspaceId}/properties/${propertyId}/recommendation`);
  check("5b. recommendation honest status", rec.status === 200 && typeof rec.data?.status === "string", `status=${rec.status}`);
  const fixRes = await req("GET", `/workspaces/${workspaceId}/properties/${propertyId}/fix`);
  check("6. fix read 200", fixRes.status === 200, `status=${fixRes.status}`);
  const fixId = fixRes.data?.fix?.id;
  if (!fixId) {
    skipped.push("7-9. apply/measurement/history (no fix produced by live data)");
  } else {
    const apply = await req("POST", `/workspaces/${workspaceId}/properties/${propertyId}/fix/${fixId}/apply`, {}, { csrf });
    check("7. apply 201 + baseline window", apply.status === 201 && !!apply.data?.fix?.expectedMeasurementDate, `status=${apply.status}`);
    const checkRes = await req("POST", `/workspaces/${workspaceId}/properties/${propertyId}/fix/${fixId}/check`, {}, { csrf });
    check(
      "8. measurement status honest (pending or terminal, never fabricated)",
      checkRes.status === 201 && typeof checkRes.data?.status === "string",
      `status=${checkRes.status}`,
    );
  }
  const history = await req("GET", `/workspaces/${workspaceId}/history`);
  check("9. history 200 + shape", history.status === 200 && Array.isArray(history.data?.items), `status=${history.status}`);

  console.log(`RESULT: ${passed} passed, ${failed} failed, ${skipped.length} skipped`);
  for (const s of skipped) console.log(`SKIP ${s}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`SMOKE ERROR ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
