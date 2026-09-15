import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, daysAgoIso, formatDate, makeTrailingPeriod, nowIso } from "../dates.ts";

test("addDays advances by the exact number of UTC days", () => {
  assert.equal(addDays("2026-09-01T00:00:00.000Z", 14), "2026-09-15T00:00:00.000Z");
  assert.equal(addDays("2026-09-01T00:00:00.000Z", -14), "2026-08-18T00:00:00.000Z");
  assert.equal(addDays("2026-09-01T00:00:00.000Z", 0), "2026-09-01T00:00:00.000Z");
});

test("daysAgoIso is the inverse of addDays", () => {
  const from = "2026-09-15T00:00:00.000Z";
  assert.equal(daysAgoIso(14, from), addDays(from, -14));
});

test("formatDate renders a stable, human-readable date regardless of local timezone", () => {
  // Fixed UTC timezone in the formatter means this never depends on the
  // machine running the test.
  assert.equal(formatDate("2026-09-01T00:00:00.000Z"), "September 1, 2026");
  assert.equal(formatDate("2026-01-01T23:59:59.000Z"), "January 1, 2026");
});

test("makeTrailingPeriod builds a period ending exactly on the given date", () => {
  const period = makeTrailingPeriod(28, "2026-09-15T00:00:00.000Z");
  assert.equal(period.end, "2026-09-15T00:00:00.000Z");
  assert.equal(period.start, addDays("2026-09-15T00:00:00.000Z", -28));
  assert.match(period.label, /28 days/);
});

test("makeTrailingPeriod defaults end to now when not given", () => {
  const before = Date.now();
  const period = makeTrailingPeriod(7);
  const end = new Date(period.end).getTime();
  assert.ok(end >= before && end <= Date.now() + 1000, "period.end should be close to now");
});

test("nowIso returns a valid ISO timestamp", () => {
  assert.doesNotThrow(() => new Date(nowIso()).toISOString());
});
