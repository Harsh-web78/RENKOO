/**
 * PRODUCTION ENV VALIDATION TESTS — Prompt 9 (fail-closed production build).
 *
 * Exercises scripts/validate-prod-env.mjs as a subprocess with controlled
 * environments (T1–T8), plus asserts the npm script wiring keeps development
 * (`build`/`dev`/`test`) free of the production gate while `build:prod`
 * enforces it. No production variables required; no network access.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = path.join(repoRoot, "scripts", "validate-prod-env.mjs");

function run(args: string[], env: Record<string, string>): { exit: number; stdout: string; stderr: string } {
  const clean: Record<string, string | undefined> = { ...process.env };
  delete clean.NEXT_PUBLIC_USE_REAL_PROVIDER;
  delete clean.NEXT_PUBLIC_API_BASE;
  delete clean.RENKOO_EXPECTED_API_BASE;
  try {
    const stdout = execFileSync("node", [script, ...args], {
      env: { ...clean, ...env } as NodeJS.ProcessEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { exit: 0, stdout, stderr: "" };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: unknown; stderr?: unknown };
    return { exit: err.status ?? 1, stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? "") };
  }
}

const VALID = {
  NEXT_PUBLIC_USE_REAL_PROVIDER: "true",
  NEXT_PUBLIC_API_BASE: "https://api.example.com/api/v1",
};

test("T1. Production + valid HTTPS API + real provider → PASS", () => {
  const r = run(["--production"], VALID);
  assert.equal(r.exit, 0);
});

test("T2. Production + missing NEXT_PUBLIC_USE_REAL_PROVIDER → FAIL", () => {
  const r = run(["--production"], { NEXT_PUBLIC_API_BASE: VALID.NEXT_PUBLIC_API_BASE });
  assert.notEqual(r.exit, 0);
  assert.match(r.stderr, /NEXT_PUBLIC_USE_REAL_PROVIDER=true/);
});

test("T3. Production + provider=false → FAIL", () => {
  for (const v of ["false", "0", "yes", "TRUE", ""]) {
    const r = run(["--production"], { ...VALID, NEXT_PUBLIC_USE_REAL_PROVIDER: v });
    assert.notEqual(r.exit, 0, `provider=${JSON.stringify(v)} must fail`);
  }
});

test("T4. Production + missing API base → FAIL", () => {
  const r = run(["--production"], { NEXT_PUBLIC_USE_REAL_PROVIDER: "true" });
  assert.notEqual(r.exit, 0);
  assert.match(r.stderr, /NEXT_PUBLIC_API_BASE/);
});

test("T5. Production + localhost API → FAIL", () => {
  for (const v of [
    "http://localhost:3000/api/v1",
    "https://localhost/api/v1",
    "https://127.0.0.1/api/v1",
    "https://0.0.0.0/api/v1",
    "https://[::1]/api/v1",
  ]) {
    const r = run(["--production"], { ...VALID, NEXT_PUBLIC_API_BASE: v });
    assert.notEqual(r.exit, 0, `base=${v} must fail`);
  }
});

test("T6. Production + HTTP API → FAIL", () => {
  const r = run(["--production"], { ...VALID, NEXT_PUBLIC_API_BASE: "http://api.example.com/api/v1" });
  assert.notEqual(r.exit, 0);
});

test("T7. Production + valid HTTPS API → PASS", () => {
  const r = run(["--production"], VALID);
  assert.equal(r.exit, 0);
  assert.match(r.stdout, /validation passed/);
});

test("T8. Development + localhost + mock provider → PASS (gate not enforced)", () => {
  const r = run([], {
    NEXT_PUBLIC_API_BASE: "http://localhost:3000/api/v1",
  });
  assert.equal(r.exit, 0);
  // And the standard scripts must not invoke the gate…
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  for (const name of ["dev", "build", "test", "typecheck", "lint"]) {
    assert.doesNotMatch(pkg.scripts[name] ?? "", /validate-prod-env/, `${name} must stay gate-free`);
  }
  // …while build:prod must enforce it before building.
  assert.match(pkg.scripts["build:prod"] ?? "", /validate-prod-env\.mjs --production/);
  assert.match(pkg.scripts["build:prod"] ?? "", /next build/);
});

test("Optional exact-origin pin is honored only when configured", () => {
  const ok = run(["--production", "--expected-api-base=https://api.example.com/api/v1"], VALID);
  assert.equal(ok.exit, 0);
  const wrong = run(["--production", "--expected-api-base=https://api.other.example/api/v1"], VALID);
  assert.notEqual(wrong.exit, 0);
  // Without the pin, any valid HTTPS origin passes (no hardcoded domain).
  const unpinned = run(["--production"], VALID);
  assert.equal(unpinned.exit, 0);
});
