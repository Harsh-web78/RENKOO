/**
 * PROVIDER SELECTION TESTS — Prompt 13 §14 items 15–17.
 *
 * The mock provider must keep working, and the feature flag must select
 * mock by default and the real provider only when explicitly enabled.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isRealProviderEnabled, resolveProviderKind } from "../provider-selection.ts";
import { MockSearchDataProvider } from "../mock-provider.ts";

function envWith(flag: string | undefined): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (flag === undefined) delete env.NEXT_PUBLIC_USE_REAL_PROVIDER;
  else env.NEXT_PUBLIC_USE_REAL_PROVIDER = flag;
  return env;
}

test("16. feature flag unset/false selects the Mock provider (default)", () => {
  assert.equal(resolveProviderKind(envWith(undefined)), "mock");
  assert.equal(resolveProviderKind(envWith("false")), "mock");
  assert.equal(resolveProviderKind(envWith("")), "mock");
  assert.equal(resolveProviderKind({}), "mock");
  assert.equal(isRealProviderEnabled(envWith(undefined)), false);
  assert.equal(isRealProviderEnabled({}), false);
});

test("17. feature flag true selects the API provider", () => {
  assert.equal(resolveProviderKind(envWith("true")), "real");
  assert.equal(resolveProviderKind(envWith("1")), "real");
  assert.equal(resolveProviderKind({ NEXT_PUBLIC_USE_REAL_PROVIDER: "true" }), "real");
  assert.equal(resolveProviderKind({ NEXT_PUBLIC_USE_REAL_PROVIDER: "1" }), "real");
  assert.equal(resolveProviderKind({ NEXT_PUBLIC_USE_REAL_PROVIDER: "false" }), "mock");
  assert.equal(isRealProviderEnabled(envWith("true")), true);
});

test("15. Mock provider still works (properties + recommendation + honest empties)", async () => {
  const properties = await MockSearchDataProvider.getProperties();
  assert.equal(properties.ok, true);
  if (properties.ok) {
    assert.ok(properties.data.some((p) => p.id === "example.com"));
  }
  const recommendation = await MockSearchDataProvider.getRecommendationResult("example.com");
  assert.equal(recommendation.status, "recommendation-available");
  assert.ok(recommendation.recommendation);
  const insufficient = await MockSearchDataProvider.getRecommendationResult("clientsite.com");
  assert.equal(insufficient.status, "insufficient-data");
});
