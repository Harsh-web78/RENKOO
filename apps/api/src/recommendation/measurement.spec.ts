import { measurementConfig } from "./measurement-config";

/**
 * Pure measurement classification tests — no DB, no Google.
 * Mirrors classifyOutcome logic in recommendation.service.ts
 */

function classifyOutcome(params: {
  before: { clicks: number; ctr: number; position: number };
  after: { clicks: number; ctr: number; position: number };
  snapshotQuality: string;
  snapshotFreshness: string;
  impressions: number;
}): string {
  const { before, after, snapshotQuality, snapshotFreshness, impressions } = params;
  const cfg = measurementConfig;

  if (snapshotQuality === "missing" || snapshotQuality === "unavailable" || impressions < cfg.MIN_IMPRESSIONS_FOR_MEASUREMENT) {
    return "insufficient_data";
  }
  if (snapshotFreshness === "delayed" || snapshotFreshness === "stale") {
    return "data_delayed";
  }

  const clicksPct = before.clicks === 0 ? (after.clicks > 0 ? 1 : 0) : (after.clicks - before.clicks) / before.clicks;
  const ctrDelta = after.ctr - before.ctr;
  const posDelta = after.position - before.position;

  const clicksUp = clicksPct >= cfg.POSITIVE_CLICKS_PCT;
  const clicksDown = clicksPct <= cfg.NEGATIVE_CLICKS_PCT;
  const posImproved = posDelta <= -cfg.POSITION_IMPROVEMENT;
  const posWorsened = posDelta >= cfg.POSITION_IMPROVEMENT;
  const ctrUp = ctrDelta >= cfg.CTR_IMPROVEMENT_ABSOLUTE;
  const ctrDown = ctrDelta <= cfg.CTR_DECLINE_ABSOLUTE;

  const conflicting =
    (clicksUp && posWorsened) ||
    (clicksDown && posImproved) ||
    (clicksUp && ctrDown && posWorsened) ||
    (clicksDown && ctrUp && posImproved);
  if (conflicting) {
    const clicksConflict = Math.abs(clicksPct) >= cfg.CONFLICTING_CLICKS_PCT;
    const posConflict = Math.abs(posDelta) >= cfg.CONFLICTING_POSITION_DELTA;
    if (clicksConflict && posConflict) return "conflicting_data";
  }

  if ((clicksUp && (posImproved || ctrUp)) || (posImproved && ctrUp)) return "positive_change";
  if ((clicksDown && (posWorsened || ctrDown)) || (posWorsened && ctrDown)) return "negative_change";
  if (clicksUp) return "positive_change";
  if (clicksDown) return "negative_change";

  return "no_material_change";
}

describe("Measurement classification (pure)", () => {
  it("6. POSITIVE_CHANGE clicks +≥10% with position/ctr improvement", () => {
    const r = classifyOutcome({
      before: { clicks: 100, ctr: 0.02, position: 4.2 },
      after: { clicks: 115, ctr: 0.023, position: 3.5 },
      snapshotQuality: "complete",
      snapshotFreshness: "fresh",
      impressions: 1000,
    });
    expect(r).toBe("positive_change");
  });

  it("7. NO_MATERIAL_CHANGE within band", () => {
    const r = classifyOutcome({
      before: { clicks: 100, ctr: 0.02, position: 4.2 },
      after: { clicks: 102, ctr: 0.0205, position: 4.1 },
      snapshotQuality: "complete",
      snapshotFreshness: "fresh",
      impressions: 1000,
    });
    expect(r).toBe("no_material_change");
  });

  it("8. NEGATIVE_CHANGE clicks -10% with worsened position", () => {
    const r = classifyOutcome({
      before: { clicks: 100, ctr: 0.02, position: 3.5 },
      after: { clicks: 88, ctr: 0.018, position: 4.3 },
      snapshotQuality: "complete",
      snapshotFreshness: "fresh",
      impressions: 1000,
    });
    expect(r).toBe("negative_change");
  });

  it("9. INSUFFICIENT_DATA when impressions <50", () => {
    const r = classifyOutcome({
      before: { clicks: 5, ctr: 0.02, position: 4 },
      after: { clicks: 6, ctr: 0.02, position: 4 },
      snapshotQuality: "complete",
      snapshotFreshness: "fresh",
      impressions: 30,
    });
    expect(r).toBe("insufficient_data");
  });

  it("10. DATA_DELAYED when freshness delayed", () => {
    const r = classifyOutcome({
      before: { clicks: 100, ctr: 0.02, position: 4 },
      after: { clicks: 120, ctr: 0.025, position: 3.5 },
      snapshotQuality: "complete",
      snapshotFreshness: "delayed",
      impressions: 1000,
    });
    expect(r).toBe("data_delayed");
  });

  it("11. CONFLICTING_DATA clicks up but position down", () => {
    const r = classifyOutcome({
      before: { clicks: 100, ctr: 0.02, position: 4 },
      after: { clicks: 115, ctr: 0.018, position: 5.0 },
      snapshotQuality: "complete",
      snapshotFreshness: "fresh",
      impressions: 1000,
    });
    expect(r).toBe("conflicting_data");
  });

  it("13. deterministic classification", () => {
    const params = {
      before: { clicks: 100, ctr: 0.02, position: 4.2 },
      after: { clicks: 115, ctr: 0.023, position: 3.5 },
      snapshotQuality: "complete",
      snapshotFreshness: "fresh",
      impressions: 1000,
    };
    expect(classifyOutcome(params)).toBe(classifyOutcome(params));
  });

  it("4-5. CTR/position delta calculation", () => {
    const r1 = classifyOutcome({
      before: { clicks: 100, ctr: 0.02, position: 4 },
      after: { clicks: 100, ctr: 0.025, position: 4 },
      snapshotQuality: "complete",
      snapshotFreshness: "fresh",
      impressions: 1000,
    });
    // CTR up alone without clicks/position should still be no_material (needs clicks or position)
    expect(r1).toBe("no_material_change");

    const r2 = classifyOutcome({
      before: { clicks: 100, ctr: 0.02, position: 4 },
      after: { clicks: 100, ctr: 0.02, position: 3.2 },
      snapshotQuality: "complete",
      snapshotFreshness: "fresh",
      impressions: 1000,
    });
    expect(r2).toBe("no_material_change"); // position improvement alone without clicks/ctr not enough per our logic (needs ctrUp too)
  });

  it("no fake success without data", () => {
    const r = classifyOutcome({
      before: { clicks: 0, ctr: 0, position: 0 },
      after: { clicks: 0, ctr: 0, position: 0 },
      snapshotQuality: "missing",
      snapshotFreshness: "fresh",
      impressions: 0,
    });
    expect(r).toBe("insufficient_data");
  });

  it("no token in classification (pure)", () => {
    const r = classifyOutcome({
      before: { clicks: 100, ctr: 0.02, position: 4 },
      after: { clicks: 110, ctr: 0.022, position: 3.8 },
      snapshotQuality: "complete",
      snapshotFreshness: "fresh",
      impressions: 1000,
    });
    const str = JSON.stringify(r);
    expect(str).not.toMatch(/Bearer|refresh_token/i);
  });
});

describe("Measurement thresholds — boundary values (Prompt 14 §8)", () => {
  const fresh = { snapshotQuality: "complete", snapshotFreshness: "fresh", impressions: 1000 };

  it("clicks exactly +10% (inclusive) with CTR improvement → positive_change", () => {
    expect(
      classifyOutcome({ before: { clicks: 100, ctr: 0.02, position: 4.0 }, after: { clicks: 110, ctr: 0.022, position: 4.0 }, ...fresh }),
    ).toBe("positive_change");
  });

  it("clicks +9.9% (just below) → no_material_change", () => {
    // 109.9 clicks is impossible in reality; use 109/100 = +9%.
    expect(
      classifyOutcome({ before: { clicks: 100, ctr: 0.02, position: 4.0 }, after: { clicks: 109, ctr: 0.022, position: 4.0 }, ...fresh }),
    ).toBe("no_material_change");
  });

  it("clicks exactly -10% (inclusive) with CTR decline → negative_change", () => {
    expect(
      classifyOutcome({ before: { clicks: 100, ctr: 0.02, position: 4.0 }, after: { clicks: 90, ctr: 0.018, position: 4.0 }, ...fresh }),
    ).toBe("negative_change");
  });

  it("clicks -9% (just above) → no_material_change", () => {
    expect(
      classifyOutcome({ before: { clicks: 100, ctr: 0.02, position: 4.0 }, after: { clicks: 91, ctr: 0.018, position: 4.0 }, ...fresh }),
    ).toBe("no_material_change");
  });

  it("position exactly -0.7 (inclusive) with CTR improvement → positive_change", () => {
    // NOTE: after-CTR uses 0.025 (not 0.022) so the CTR side of the
    // conjunction is unambiguous in binary floating point; the position
    // side genuinely exercises posDelta == -0.7 inclusive.
    expect(
      classifyOutcome({ before: { clicks: 100, ctr: 0.02, position: 4.0 }, after: { clicks: 100, ctr: 0.025, position: 3.3 }, ...fresh }),
    ).toBe("positive_change");
  });

  it("position -0.69 (just inside band) with CTR improvement but flat clicks → no_material_change", () => {
    expect(
      classifyOutcome({ before: { clicks: 100, ctr: 0.02, position: 4.0 }, after: { clicks: 100, ctr: 0.025, position: 3.31 }, ...fresh }),
    ).toBe("no_material_change");
  });

  it("position exactly +0.7 (inclusive decline) with CTR decline → negative_change", () => {
    expect(
      classifyOutcome({ before: { clicks: 100, ctr: 0.02, position: 4.0 }, after: { clicks: 100, ctr: 0.018, position: 4.7 }, ...fresh }),
    ).toBe("negative_change");
  });

  it("impressions exactly 50 (inclusive minimum) → measured, not insufficient", () => {
    expect(
      classifyOutcome({
        before: { clicks: 10, ctr: 0.02, position: 4.0 },
        after: { clicks: 12, ctr: 0.024, position: 3.9 },
        snapshotQuality: "complete",
        snapshotFreshness: "fresh",
        impressions: 50,
      }),
    ).toBe("positive_change");
  });

  it("impressions 49 (just below minimum) → insufficient_data", () => {
    expect(
      classifyOutcome({
        before: { clicks: 10, ctr: 0.02, position: 4.0 },
        after: { clicks: 12, ctr: 0.024, position: 3.9 },
        snapshotQuality: "complete",
        snapshotFreshness: "fresh",
        impressions: 49,
      }),
    ).toBe("insufficient_data");
  });

  it("conflicting: clicks +12% with position +0.8 (opposite, beyond band) → conflicting_data", () => {
    expect(
      classifyOutcome({ before: { clicks: 100, ctr: 0.02, position: 4.0 }, after: { clicks: 112, ctr: 0.02, position: 4.8 }, ...fresh }),
    ).toBe("conflicting_data");
  });

  it("conflicting just-inside band: clicks +12% with position +0.6 → positive_change (not conflicting)", () => {
    expect(
      classifyOutcome({ before: { clicks: 100, ctr: 0.02, position: 4.0 }, after: { clicks: 112, ctr: 0.02, position: 4.6 }, ...fresh }),
    ).toBe("positive_change");
  });

  it("stale freshness → data_delayed even with strong improvement", () => {
    expect(
      classifyOutcome({
        before: { clicks: 100, ctr: 0.02, position: 4.0 },
        after: { clicks: 150, ctr: 0.03, position: 3.0 },
        snapshotQuality: "complete",
        snapshotFreshness: "stale",
        impressions: 1000,
      }),
    ).toBe("data_delayed");
  });

  it("unavailable quality → insufficient_data (never a fabricated outcome)", () => {
    expect(
      classifyOutcome({
        before: { clicks: 100, ctr: 0.02, position: 4.0 },
        after: { clicks: 150, ctr: 0.03, position: 3.0 },
        snapshotQuality: "unavailable",
        snapshotFreshness: "fresh",
        impressions: 1000,
      }),
    ).toBe("insufficient_data");
  });

  it("zero baseline clicks with later activity → positive_change (divide-by-zero guard)", () => {
    expect(
      classifyOutcome({ before: { clicks: 0, ctr: 0, position: 5.0 }, after: { clicks: 10, ctr: 0.02, position: 4.0 }, ...fresh }),
    ).toBe("positive_change");
  });

  it("pure clicks movement at threshold without position/ctr confirmation still classifies (documented fallback)", () => {
    // +10% clicks, flat ctr/position: clicksUp alone → positive_change.
    expect(
      classifyOutcome({ before: { clicks: 100, ctr: 0.02, position: 4.0 }, after: { clicks: 110, ctr: 0.02, position: 4.0 }, ...fresh }),
    ).toBe("positive_change");
  });
});
