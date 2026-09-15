import { test } from "node:test";
import assert from "node:assert/strict";
import { seedPropertyState } from "../../mock/product-service.ts";

test("each property seeds independent, non-shared state objects", () => {
  const example = seedPropertyState("example.com", null);
  const www = seedPropertyState("www.example.com", null);
  const client = seedPropertyState("clientsite.com", null);
  const stale = seedPropertyState("staleclient.com", null);
  const old = seedPropertyState("oldproject.com", null);

  // Distinct fix ids — never accidentally shared across properties.
  const fixIds = [example.currentFix?.id, www.currentFix?.id].filter(Boolean);
  assert.equal(new Set(fixIds).size, fixIds.length, "fix ids must be unique per property");

  // Distinct pages — proves the actual content differs, not just the id.
  assert.notEqual(example.currentFix?.page, www.currentFix?.page);

  // Only the properties designed to have a fix have one; the rest are honest empties.
  assert.ok(example.currentFix, "example.com should have a live fix");
  assert.ok(www.currentFix, "www.example.com should have its own live fix");
  assert.equal(client.currentFix, null);
  assert.equal(stale.currentFix, null);
  assert.equal(old.currentFix, null);
});

test("each no-fix property reports the reason it was actually seeded with — never a generic fallback", () => {
  assert.equal(seedPropertyState("clientsite.com", null).noFixReason, "insufficient-data");
  assert.equal(seedPropertyState("staleclient.com", null).noFixReason, "stale-data");
  assert.equal(seedPropertyState("oldproject.com", null).noFixReason, "connection-error");
});

test("mutating one property's seeded state object does not affect another property's independently-seeded state", () => {
  const example = seedPropertyState("example.com", null);
  const www = seedPropertyState("www.example.com", null);

  const originalWwwPage = www.currentFix!.page;
  // Mutate example's object directly (simulating a bug where the same
  // reference was accidentally shared) and confirm www is unaffected.
  example.currentFix!.page = "/mutated";
  example.history.push({
    id: "fake",
    fix: example.currentFix!,
    page: "/mutated",
    recommendedChange: "fake",
    status: "dismissed",
    appliedAt: null,
  });

  assert.equal(www.currentFix!.page, originalWwwPage, "www.example.com's fix must not be affected by mutating example.com's");
  assert.equal(www.history.length, 0, "www.example.com's history must not pick up example.com's mutation");
});

test("example.com prefers the caller's onboarding fix over its own default seed, without leaking into other properties", () => {
  const onboardingFix = {
    page: "/custom-onboarding-page",
    clicks: 5,
    clicksDeltaPct: -10,
    impressions: 50,
    ctr: "1.0%",
    position: 9.9,
    positionBaseline: 8.8,
    finding: "custom finding",
    recommendedChange: "custom recommendation",
    why: "custom rationale",
    evidence: { windowLabel: "test window", rows: [] },
  };

  const example = seedPropertyState("example.com", onboardingFix);
  const www = seedPropertyState("www.example.com", onboardingFix); // same object passed — must be ignored for other properties

  assert.equal(example.currentFix?.page, "/custom-onboarding-page");
  assert.notEqual(www.currentFix?.page, "/custom-onboarding-page", "onboarding fix override must only apply to example.com");
});

test("history is scoped per property — example.com's seeded history never appears for another property", () => {
  const example = seedPropertyState("example.com", null);
  const www = seedPropertyState("www.example.com", null);
  const client = seedPropertyState("clientsite.com", null);

  assert.ok(example.history.length > 0, "example.com should have seeded history");
  assert.equal(www.history.length, 0);
  assert.equal(client.history.length, 0);
  for (const item of example.history) {
    assert.ok(item.id.startsWith("example.com::"), "history item ids must be scoped to their own property");
  }
});
