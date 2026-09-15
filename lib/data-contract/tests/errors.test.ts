import { test } from "node:test";
import assert from "node:assert/strict";
import { dataError, err, ok } from "../errors.ts";

test("ok() produces a discriminable success result", () => {
  const result = ok({ value: 42 });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.value, 42);
});

test("err() produces a discriminable failure result carrying a normalized error", () => {
  const result = err(dataError("UPSTREAM_ERROR", "Could not reach the provider."));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "UPSTREAM_ERROR");
    assert.equal(typeof result.error.message, "string");
  }
});

test("dataError never carries a raw stack trace or provider payload — message is a short user-safe string", () => {
  const error = dataError("PERMISSION_DENIED", "RENKO doesn't have access to this property.");
  assert.equal(error.code, "PERMISSION_DENIED");
  assert.ok(!error.message.includes("at "), "message should not look like a stack trace");
  assert.ok(error.message.length < 200);
});

test("every required error code is a valid DataErrorCode (compile-time contract, exercised at runtime for the ones the mock provider actually uses)", () => {
  const codes = [
    "AUTH_REQUIRED",
    "PERMISSION_DENIED",
    "PROPERTY_NOT_FOUND",
    "NO_DATA",
    "INSUFFICIENT_DATA",
    "STALE_DATA",
    "PARTIAL_DATA",
    "RATE_LIMITED",
    "UPSTREAM_ERROR",
    "UNKNOWN_ERROR",
  ] as const;
  for (const code of codes) {
    const error = dataError(code, "example");
    assert.equal(error.code, code);
  }
});
