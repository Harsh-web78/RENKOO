/**
 * Production environment validation — Prompt 9 (fail-closed production build).
 *
 * Invoked explicitly by `npm run build:prod` as:
 *   node scripts/validate-prod-env.mjs --production && next build
 *
 * - With `--production`: requires NEXT_PUBLIC_USE_REAL_PROVIDER=true (or the
 *   explicitly supported equivalent "1") and NEXT_PUBLIC_API_BASE=https://…
 *   (non-loopback). Any violation exits non-zero BEFORE the build starts.
 * - Without `--production` (dev/test/accidental use): exits 0 without
 *   enforcing anything, so development mock/localhost behavior is untouched.
 *
 * Deterministic: no network access, no filesystem writes. Inspects ONLY the
 * two public frontend variables (+ its own flags). Never prints backend
 * secrets and never dumps the environment.
 */

import { fileURLToPath } from "node:url";

const PRODUCTION_FLAG = "--production";
const EXPECTED_BASE_FLAG_PREFIX = "--expected-api-base=";
const EXPECTED_BASE_ENV = "RENKOO_EXPECTED_API_BASE";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

function fail(message) {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exitCode = 1;
}

function validateProvider(raw) {
  // Must match lib/data-contract/provider-selection.ts exactly: only "true"
  // (or the explicitly supported equivalent "1") selects the real provider.
  // Anything else — missing, "false", "0", arbitrary strings — is mock.
  return raw === "true" || raw === "1";
}

function apiBaseError(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return "Production build requires a valid HTTPS NEXT_PUBLIC_API_BASE";
  }
  const value = String(raw).trim();
  let url;
  try {
    url = new URL(value);
  } catch {
    return "Production build requires a valid HTTPS NEXT_PUBLIC_API_BASE";
  }
  if (url.protocol !== "https:") {
    return "Production build requires a valid HTTPS NEXT_PUBLIC_API_BASE";
  }
  // Node's URL keeps IPv6 brackets in hostname ("[::1]") — normalize first.
  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (LOOPBACK_HOSTNAMES.has(hostname)) {
    return "Production build requires a valid HTTPS NEXT_PUBLIC_API_BASE";
  }
  return null;
}

function main(argv, env) {
  const production = argv.includes(PRODUCTION_FLAG);
  if (!production) {
    process.stdout.write("Skipping production env validation (development mode).\n");
    return 0;
  }
  const providerRaw = env.NEXT_PUBLIC_USE_REAL_PROVIDER;
  if (!validateProvider(providerRaw)) {
    fail("Production build requires NEXT_PUBLIC_USE_REAL_PROVIDER=true");
    return 1;
  }
  const baseError = apiBaseError(env.NEXT_PUBLIC_API_BASE);
  if (baseError !== null) {
    fail(baseError);
    return 1;
  }
  // Optional exact-origin pin for pipelines that want it (e.g.
  // --expected-api-base=https://api.renkoo.online/api/v1). Never hardcoded;
  // only enforced when explicitly configured.
  const expectedFromFlag = argv.find((a) => a.startsWith(EXPECTED_BASE_FLAG_PREFIX));
  const expected = expectedFromFlag
    ? expectedFromFlag.slice(EXPECTED_BASE_FLAG_PREFIX.length)
    : env[EXPECTED_BASE_ENV];
  if (expected !== undefined && expected !== "") {
    const actual = String(env.NEXT_PUBLIC_API_BASE).trim().replace(/\/+$/, "");
    if (actual !== String(expected).trim().replace(/\/+$/, "")) {
      fail("Production build NEXT_PUBLIC_API_BASE does not match the expected production origin");
      return 1;
    }
  }
  process.stdout.write("Production env validation passed.\n");
  return 0;
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2), process.env) ?? 0;
}

export { validateProvider, apiBaseError, main };
