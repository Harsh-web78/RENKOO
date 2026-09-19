import {
  TestApp,
  createTestApp,
  closeTestApp,
  truncateAll,
  signupAgent,
  csrfToken,
  createPropertyRow,
  seedSignalSnapshot,
} from "../test-utils/e2e-fixtures";

/**
 * Remember layer (Prompt 2): dismissed evidence is remembered until genuinely
 * new evidence appears.
 *
 * Conventions: the recommendation/fix/history endpoints under test are always
 * exercised through HTTP; all other rows are setup-only direct-DB writes.
 * Three app instances spread the per-app throttle budgets (global 60/min/IP):
 *   - appA: core dismissed lifecycle (tests 1, 2, 3+4)
 *   - appB: scope isolation — page / signal / property (tests 6, 7, 8)
 *   - appC: workspace isolation, legacy NULL, orphan, history (9–12)
 * Data lives in one test database; every test uses unique workspaces/tags so
 * groups never interfere. Each agent reuses a single CSRF token.
 *
 * Memory scope is always (workspace, property, page, signal) — never wider.
 */
describe("Remember / dismissed suppression (Prompt 2)", () => {
  let appA: TestApp;
  let appB: TestApp;
  let appC: TestApp;

  /** Setup-only direct snapshot write for evidence variants the seed helper does not cover. */
  async function writeSnapshot(
    prisma: TestApp["prisma"],
    params: {
      workspaceId: string;
      propertyId: string;
      siteUrl: string;
      page: { page: string; clicks: number; impressions: number; ctr: number; position: number };
      comparisonPage: { page: string; clicks: number; impressions: number; ctr: number; position: number };
      queries: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>;
      periodLabel?: string;
    },
  ): Promise<void> {
    const now = new Date();
    const periodStart = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
    const label = params.periodLabel ?? "Custom window vs. prior";
    await prisma.searchDataSnapshot.create({
      data: {
        workspaceId: params.workspaceId,
        propertyId: params.propertyId,
        siteUrl: params.siteUrl,
        periodStart,
        periodEnd: now,
        periodLabel: label,
        dataThrough: now,
        retrievedAt: now,
        freshness: "fresh",
        quality: "complete",
        limitations: [],
        normalizedJson: {
          meta: {
            source: { id: "google-search-console", label: "Google Search Console" },
            property: { id: params.propertyId, name: "example.com", type: "domain", siteUrl: params.siteUrl },
            period: { start: periodStart.toISOString(), end: now.toISOString(), label },
            dataThrough: now.toISOString(),
            retrievedAt: now.toISOString(),
            freshness: "fresh",
            quality: "complete",
            limitations: [],
          },
          page: params.page,
          comparisonPage: params.comparisonPage,
          queries: params.queries,
        } as any,
        rawResponseHash: `remember-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        rowCount: 1,
      },
    });
  }

  /** Fresh workspace + direct property + canonical seed, exercised through HTTP. */
  async function setupSeededProperty(
    app: TestApp,
    tag: string,
  ): Promise<{ agent: any; workspaceId: string; propertyId: string; siteUrl: string; token: string }> {
    const { agent, workspaceId } = await signupAgent(app.app, tag);
    const prop = await createPropertyRow(app.prisma, { workspaceId, siteUrl: `sc-domain:${tag}.test` });
    await seedSignalSnapshot(app.prisma, { workspaceId, propertyId: prop.id, siteUrl: prop.siteUrl });
    await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/recommendation`).expect(200);
    const token = await csrfToken(agent);
    return { agent, workspaceId, propertyId: prop.id, siteUrl: prop.siteUrl, token };
  }

  async function currentFixId(agent: any, workspaceId: string, propertyId: string): Promise<string> {
    const res = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/fix`).expect(200);
    return res.body.fix.id as string;
  }

  async function dismiss(agent: any, workspaceId: string, propertyId: string, fixId: string, token: string, reason?: string): Promise<void> {
    await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/fix/${fixId}/dismiss`)
      .set("x-csrf-token", token)
      .send(reason ? { reason } : {})
      .expect(201);
  }

  /** Materially changed ctr-below-expected evidence for /pricing (same signal, new fingerprint). */
  function freshEvidence() {
    return {
      clicks: 84,
      impressions: 3400,
      ctr: 0.0247,
      position: 4.7,
      priorClicks: 110,
      priorImpressions: 3300,
      priorCtr: 0.0333,
      priorPosition: 4.4,
      queries: [
        { query: "pricing plans", clicks: 38, impressions: 1250, ctr: 0.03, position: 4.3 },
        { query: "team pricing", clicks: 16, impressions: 720, ctr: 0.022, position: 4.9 },
      ],
      periodLabel: "Fresh window vs. prior",
    };
  }

  beforeAll(async () => {
    appA = await createTestApp();
    appB = await createTestApp();
    appC = await createTestApp();
    await truncateAll(appA.prisma);
  });

  afterAll(async () => {
    await truncateAll(appA.prisma);
    await closeTestApp(appA);
    await closeTestApp(appB);
    await closeTestApp(appC);
  });

  it("1. dismissed same-evidence → no new Fix, honest no-signal, dismissed untouched", async () => {
    const { agent, workspaceId, propertyId, token } = await setupSeededProperty(appA, "remember-same");
    const fix1 = await currentFixId(agent, workspaceId, propertyId);
    await dismiss(agent, workspaceId, propertyId, fix1, token, "not-now");
    const rec = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/recommendation`).expect(200);
    expect(rec.body.status).toBe("no-signal");
    expect(rec.body.recommendation).toBeUndefined();
    const fixNow = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/fix`).expect(200);
    expect(fixNow.body.fix).toBeNull();
    expect(await appA.prisma.fix.count({ where: { workspaceId, propertyId } })).toBe(1);
    const row = await appA.prisma.fix.findUnique({ where: { id: fix1 } });
    expect(row?.status).toBe("dismissed");
  });

  it("2. dismissed new period + identical evidence → still no new Fix", async () => {
    const { agent, workspaceId, propertyId, siteUrl, token } = await setupSeededProperty(appA, "remember-period");
    const fix1 = await currentFixId(agent, workspaceId, propertyId);
    await dismiss(agent, workspaceId, propertyId, fix1, token);
    // Same metrics, new period labels/timestamps: identical fingerprint.
    await seedSignalSnapshot(appA.prisma, { workspaceId, propertyId, siteUrl }, { periodLabel: "Second window vs. prior" });
    const rec = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/recommendation`).expect(200);
    expect(rec.body.status).toBe("no-signal");
    expect(await appA.prisma.fix.count({ where: { workspaceId, propertyId } })).toBe(1);
  });

  it("3+4. changed fingerprint → new Fix; repeated GET reuses it (no duplicate)", async () => {
    const { agent, workspaceId, propertyId, siteUrl, token } = await setupSeededProperty(appA, "remember-new");
    const fix1 = await currentFixId(agent, workspaceId, propertyId);
    await dismiss(agent, workspaceId, propertyId, fix1, token);
    await seedSignalSnapshot(appA.prisma, { workspaceId, propertyId, siteUrl }, freshEvidence());
    const rec = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/recommendation`).expect(200);
    expect(rec.body.status).toBe("recommendation-available");
    const fix2 = await currentFixId(agent, workspaceId, propertyId);
    expect(fix2).not.toBe(fix1);
    const row2 = await appA.prisma.fix.findUnique({ where: { id: fix2 } });
    expect(row2?.status).toBe("available");
    expect(row2?.signalFingerprint).toMatch(/^[0-9a-f]{64}$/);
    // Repeat → same fix, no duplicate rows.
    await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/recommendation`).expect(200);
    expect(await currentFixId(agent, workspaceId, propertyId)).toBe(fix2);
    expect(await appA.prisma.fix.count({ where: { workspaceId, propertyId } })).toBe(2);
    expect((await appA.prisma.fix.findUnique({ where: { id: fix1 } }))?.status).toBe("dismissed");
  });

  it("6. different page does not suppress", async () => {
    const { agent, workspaceId, propertyId, siteUrl, token } = await setupSeededProperty(appB, "remember-page");
    const fix1 = await currentFixId(agent, workspaceId, propertyId);
    await dismiss(agent, workspaceId, propertyId, fix1, token);
    // Same property + same signal shape, but a different page.
    await writeSnapshot(appB.prisma, {
      workspaceId,
      propertyId,
      siteUrl,
      page: { page: "/other-path", clicks: 70, impressions: 2600, ctr: 0.0269, position: 5.0 },
      comparisonPage: { page: "/other-path", clicks: 95, impressions: 2500, ctr: 0.038, position: 4.6 },
      queries: [
        { query: "other topic", clicks: 30, impressions: 1100, ctr: 0.027, position: 4.9 },
        { query: "other guide", clicks: 14, impressions: 600, ctr: 0.023, position: 5.1 },
      ],
    });
    const rec = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/recommendation`).expect(200);
    expect(rec.body.status).toBe("recommendation-available");
    expect(rec.body.recommendation.page).toBe("/other-path");
  });

  it("7. different signal does not suppress", async () => {
    const { agent, workspaceId, propertyId, siteUrl, token } = await setupSeededProperty(appB, "remember-signal");
    const fix1 = await currentFixId(agent, workspaceId, propertyId);
    await dismiss(agent, workspaceId, propertyId, fix1, token);
    // Same page, but position-decline evidence (CTR improves → no CTR signal;
    // single query → no content-gap signal).
    await writeSnapshot(appB.prisma, {
      workspaceId,
      propertyId,
      siteUrl,
      page: { page: "/pricing", clicks: 120, impressions: 3000, ctr: 0.04, position: 5.5 },
      comparisonPage: { page: "/pricing", clicks: 90, impressions: 2950, ctr: 0.0305, position: 4.0 },
      queries: [{ query: "pricing plans", clicks: 60, impressions: 1200, ctr: 0.05, position: 5.0 }],
    });
    const rec = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/recommendation`).expect(200);
    expect(rec.body.status).toBe("recommendation-available");
    expect(rec.body.recommendation.signal).toBe("position-decline");
  });

  it("8. different property does not suppress", async () => {
    const { agent, workspaceId, propertyId, token } = await setupSeededProperty(appB, "remember-prop-a");
    const fix1 = await currentFixId(agent, workspaceId, propertyId);
    await dismiss(agent, workspaceId, propertyId, fix1, token);
    const propB = await createPropertyRow(appB.prisma, { workspaceId, siteUrl: "sc-domain:remember-prop-b.test" });
    await seedSignalSnapshot(appB.prisma, { workspaceId, propertyId: propB.id, siteUrl: propB.siteUrl });
    const rec = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propB.id}/recommendation`).expect(200);
    expect(rec.body.status).toBe("recommendation-available");
  });

  it("9. different workspace does not suppress", async () => {
    const first = await setupSeededProperty(appC, "remember-ws-a");
    const fix1 = await currentFixId(first.agent, first.workspaceId, first.propertyId);
    await dismiss(first.agent, first.workspaceId, first.propertyId, fix1, first.token);
    const second = await setupSeededProperty(appC, "remember-ws-b");
    const rec = await second.agent
      .get(`/api/v1/workspaces/${second.workspaceId}/properties/${second.propertyId}/recommendation`)
      .expect(200);
    expect(rec.body.status).toBe("recommendation-available");
  });

  it("10. legacy NULL fingerprint does not crash (backfill + fail-open)", async () => {
    // Backfill path: NULL fingerprint with intact recommendation row →
    // recomputed on read, same evidence still remembered.
    const { agent, workspaceId, propertyId, token } = await setupSeededProperty(appC, "remember-null");
    const fix1 = await currentFixId(agent, workspaceId, propertyId);
    await dismiss(agent, workspaceId, propertyId, fix1, token);
    await appC.prisma.fix.update({ where: { id: fix1 }, data: { signalFingerprint: null } });
    const rec = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/recommendation`).expect(200);
    expect(rec.body.status).toBe("no-signal");
    const backfilled = await appC.prisma.fix.findUnique({ where: { id: fix1 } });
    expect(backfilled?.signalFingerprint).toMatch(/^[0-9a-f]{64}$/);
    // Fail-open path: dismissed row with no resolvable evidence → no crash,
    // honest response (suppression must not engage on unknown evidence).
    const orphan = await appC.prisma.fix.create({
      data: { workspaceId, propertyId, recommendationId: null, page: "/pricing", status: "dismissed" },
    });
    const rec2 = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/recommendation`).expect(200);
    expect(["recommendation-available", "no-signal"]).toContain(rec2.body.status);
    await appC.prisma.fix.delete({ where: { id: orphan.id } }).catch(() => {});
  });

  it("11. previous available Fix is superseded on genuinely new evidence (no invisible orphan)", async () => {
    const { agent, workspaceId, propertyId, siteUrl } = await setupSeededProperty(appC, "remember-orphan");
    const fix1 = await currentFixId(agent, workspaceId, propertyId);
    // No dismissal: fix1 stays available while new evidence arrives.
    await seedSignalSnapshot(appC.prisma, { workspaceId, propertyId, siteUrl }, freshEvidence());
    const rec = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/recommendation`).expect(200);
    expect(rec.body.status).toBe("recommendation-available");
    const fix2 = await currentFixId(agent, workspaceId, propertyId);
    expect(fix2).not.toBe(fix1);
    expect((await appC.prisma.fix.findUnique({ where: { id: fix1 } }))?.status).toBe("superseded");
    expect(await appC.prisma.fix.count({ where: { workspaceId, propertyId, status: { in: ["available", "reviewed", "applied"] } } })).toBe(1);
  });

  it("12. history preserves both the dismissed decision and the new recommendation", async () => {
    const { agent, workspaceId, propertyId, siteUrl, token } = await setupSeededProperty(appC, "remember-hist");
    const fix1 = await currentFixId(agent, workspaceId, propertyId);
    await dismiss(agent, workspaceId, propertyId, fix1, token, "duplicate?");
    await seedSignalSnapshot(appC.prisma, { workspaceId, propertyId, siteUrl }, freshEvidence());
    await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/recommendation`).expect(200);
    const fix2 = await currentFixId(agent, workspaceId, propertyId);
    await dismiss(agent, workspaceId, propertyId, fix2, token, "still-no");
    const history = await agent.get(`/api/v1/workspaces/${workspaceId}/history`).expect(200);
    const ids = (history.body.items as any[]).map((i) => i.id);
    expect(ids).toContain(fix1);
    expect(ids).toContain(fix2);
    expect(history.body.items.find((i: any) => i.id === fix1).status).toBe("dismissed");
    expect(history.body.items.find((i: any) => i.id === fix2).status).toBe("dismissed");
  });
});
