import { test } from "node:test";
import assert from "node:assert/strict";
import { MEASUREMENT_WINDOW_DAYS, addDays, seedPropertyState, simulateOutcome } from "../../mock/product-service.ts";
import type { ProductFix } from "../../mock/types.ts";

function makeFix(id: string): ProductFix {
  const state = seedPropertyState("example.com", null);
  return { ...state.currentFix!, id };
}

test("measurement window is 14 days, and expectedMeasurementDate math is exact", () => {
  assert.equal(MEASUREMENT_WINDOW_DAYS, 14);
  const applied = "2026-09-01T00:00:00.000Z";
  assert.equal(addDays(applied, MEASUREMENT_WINDOW_DAYS), "2026-09-15T00:00:00.000Z");
});

test("simulateOutcome produces a well-formed outcome with before/after and a measuredAt timestamp", () => {
  const fix = makeFix("outcome-shape-test");
  fix.baseline = { clicks: 74, ctr: "2.6%", position: 4.2, capturedAt: "2026-09-01T00:00:00.000Z" };
  const outcome = simulateOutcome(fix, "2026-09-15T00:00:00.000Z");

  assert.ok(["positive-change", "no-material-change", "negative-change"].includes(outcome.status));
  assert.equal(outcome.before.clicks, 74);
  assert.ok(outcome.after);
  assert.equal(outcome.measuredAt, "2026-09-15T00:00:00.000Z");
});

test("simulateOutcome is deterministic — the same fix id always produces the same outcome status", () => {
  const fixA = makeFix("determinism-test-id");
  const fixB = makeFix("determinism-test-id");
  const outcomeA = simulateOutcome(fixA, "2026-09-15T00:00:00.000Z");
  const outcomeB = simulateOutcome(fixB, "2026-09-15T00:00:00.000Z");
  assert.equal(outcomeA.status, outcomeB.status);
});

test("simulateOutcome produces real variety across different fix ids (not the same bucket every time)", () => {
  const ids = ["a::1", "b::2", "c::3", "d::4", "e::5", "f::6", "g::7", "h::8"];
  const statuses = new Set(ids.map((id) => simulateOutcome(makeFix(id), "2026-09-15T00:00:00.000Z").status));
  assert.ok(statuses.size > 1, "outcome generation should be able to produce more than one status across different fixes");
});

test("outcome never claims causation in its data shape — it only records before/after observed values, no 'caused' field", () => {
  const fix = makeFix("no-causation-field-test");
  const outcome = simulateOutcome(fix, "2026-09-15T00:00:00.000Z");
  assert.equal("causedBy" in outcome, false);
  assert.equal("confidence" in outcome, false);
});
