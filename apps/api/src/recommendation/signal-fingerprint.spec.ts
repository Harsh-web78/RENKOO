import { computeSignalFingerprint, type SignalFingerprintInput } from "./signal-fingerprint";

function baseInput(): SignalFingerprintInput {
  return {
    workspaceId: "ws-1",
    propertyId: "prop-1",
    page: "/pricing",
    signal: "ctr-below-expected",
    current: { clicks: 60, impressions: 3000, ctr: 0.02, position: 4.5 },
    prior: { clicks: 90, impressions: 2900, ctr: 0.031, position: 4.3 },
    queries: [
      { query: "pricing plans", clicks: 31, impressions: 1180, ctr: 0.026, position: 4.1 },
      { query: "renko pricing", clicks: 18, impressions: 640, ctr: 0.028, position: 3.9 },
    ],
  };
}

describe("signal fingerprint (Prompt 2)", () => {
  it("is deterministic (same input → same 64-hex hash)", () => {
    const a = computeSignalFingerprint(baseInput());
    const b = computeSignalFingerprint(baseInput());
    expect(a).toBeDefined();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
  });

  it("is stable across re-ingest shapes (periods/timestamps/ids/prose excluded by construction)", () => {
    // The function signature only accepts material evidence + scope, so any
    // two snapshots with identical evidence hash identically regardless of
    // period labels, retrievedAt, or row ids (those never enter the input).
    const a = computeSignalFingerprint(baseInput());
    const b = computeSignalFingerprint({
      ...baseInput(),
      queries: baseInput().queries.map((q) => ({ ...q })),
    });
    expect(a).toBe(b);
  });

  it("normalizes underscore vs dash signal form", () => {
    const a = computeSignalFingerprint(baseInput());
    const b = computeSignalFingerprint({ ...baseInput(), signal: "ctr_below_expected" });
    expect(a).toBe(b);
  });

  it("changes on materially different evidence", () => {
    const a = computeSignalFingerprint(baseInput());
    const changedClicks = computeSignalFingerprint({
      ...baseInput(),
      current: { ...baseInput().current, clicks: 61 },
    });
    expect(changedClicks).not.toBe(a);
    const changedQuery = computeSignalFingerprint({
      ...baseInput(),
      queries: [{ query: "pricing plans", clicks: 31, impressions: 1180, ctr: 0.026, position: 4.1 }],
    });
    expect(changedQuery).not.toBe(a);
    const changedPrior = computeSignalFingerprint({
      ...baseInput(),
      prior: { ...baseInput().prior!, ctr: 0.032 },
    });
    expect(changedPrior).not.toBe(a);
  });

  it("scopes by workspace/property/page/signal (never cross-suppresses)", () => {
    const a = computeSignalFingerprint(baseInput());
    expect(computeSignalFingerprint({ ...baseInput(), workspaceId: "ws-2" })).not.toBe(a);
    expect(computeSignalFingerprint({ ...baseInput(), propertyId: "prop-2" })).not.toBe(a);
    expect(computeSignalFingerprint({ ...baseInput(), page: "/other" })).not.toBe(a);
    expect(computeSignalFingerprint({ ...baseInput(), signal: "position-decline" })).not.toBe(a);
  });

  it("returns null (unknown) on malformed input — callers fail open", () => {
    expect(computeSignalFingerprint({ ...baseInput(), workspaceId: "" })).toBeNull();
    expect(computeSignalFingerprint({ ...baseInput(), queries: null as any })).toBeNull();
    expect(
      computeSignalFingerprint({ ...baseInput(), current: { clicks: NaN, impressions: 1, ctr: 0.1, position: 1 } }),
    ).toBeNull();
  });
});
