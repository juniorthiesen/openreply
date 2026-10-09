import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => {
  const mock = {
    automation: { findFirst: vi.fn(), update: vi.fn() },
    abTest: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    trackedLink: { create: vi.fn() },
    dmLog: { groupBy: vi.fn() },
    linkClick: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  mock.$transaction.mockImplementation(async (run: (tx: typeof mock) => unknown) => run(mock));
  return mock;
});
const syncMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/client", () => ({ prisma: prismaMock }));
vi.mock("@/lib/campaigns/links", () => ({ syncCampaignLinks: syncMock }));

import { getAbPanelData } from "@/lib/ab/results";
import { AbTestError, endAbTest, startAbTest } from "@/lib/ab/tests";

const campaign = {
  id: "camp1",
  dmMessage: "Mensagem atual",
  linkButtonLabel: "Abrir",
  trackedLinks: [{ destinationUrl: "https://atual.example/p" }],
};

function runningTest(overrides: Record<string, unknown> = {}) {
  return {
    id: "test1",
    automationId: "camp1",
    status: "RUNNING",
    weightA: 50,
    winnerKey: null,
    startedAt: new Date("2026-10-10T12:00:00Z"),
    endedAt: null,
    aDmMessage: "Mensagem A",
    aLinkButtonLabel: "Abrir",
    aDestinationUrl: "https://a.example/p",
    aTrackedLinkId: "linkA",
    bDmMessage: "Mensagem B",
    bLinkButtonLabel: "Quero",
    bDestinationUrl: "https://b.example/p",
    bTrackedLinkId: "linkB",
    ...overrides,
  };
}

beforeEach(() => {
  for (const group of Object.values(prismaMock)) {
    if (typeof group === "object") for (const fn of Object.values(group)) (fn as ReturnType<typeof vi.fn>).mockReset();
  }
  prismaMock.$transaction.mockReset();
  prismaMock.$transaction.mockImplementation(async (run: (tx: typeof prismaMock) => unknown) => run(prismaMock));
  syncMock.mockReset();
});

describe("startAbTest", () => {
  const input = {
    workspaceId: "ws1",
    automationId: "camp1",
    weightA: 50,
    b: { dmMessage: "Mensagem nova", linkButtonLabel: "Quero", destinationUrl: "https://novo.example/p" },
  };

  beforeEach(() => {
    prismaMock.automation.findFirst.mockResolvedValue(campaign);
    prismaMock.abTest.findFirst.mockResolvedValue(null);
    prismaMock.trackedLink.create
      .mockResolvedValueOnce({ id: "linkA" })
      .mockResolvedValueOnce({ id: "linkB" });
    prismaMock.abTest.create.mockResolvedValue({ id: "test1" });
  });

  it("snapshots the campaign as variant A and gives each variant its own tracked link with UTM parameters", async () => {
    await startAbTest(input);

    const [linkA, linkB] = prismaMock.trackedLink.create.mock.calls.map((call) => call[0].data);
    expect(new URL(linkA.destinationUrl).searchParams.get("utm_content")).toBe("variante-a");
    expect(new URL(linkB.destinationUrl).searchParams.get("utm_content")).toBe("variante-b");
    expect(linkA.automationId).toBe("camp1");
    expect(linkA.slug).not.toBe(linkB.slug);

    expect(prismaMock.abTest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        automationId: "camp1",
        weightA: 50,
        aDmMessage: "Mensagem atual",
        aLinkButtonLabel: "Abrir",
        aDestinationUrl: "https://atual.example/p",
        aTrackedLinkId: "linkA",
        bDmMessage: "Mensagem nova",
        bLinkButtonLabel: "Quero",
        bDestinationUrl: "https://novo.example/p",
        bTrackedLinkId: "linkB",
      }),
    });
  });

  it("keeps the split between 10 and 90", async () => {
    await startAbTest({ ...input, weightA: 99 });
    expect(prismaMock.abTest.create.mock.calls[0][0].data.weightA).toBe(90);
  });

  it("refuses a second test while one is running", async () => {
    prismaMock.abTest.findFirst.mockResolvedValue({ id: "running" });
    await expect(startAbTest(input)).rejects.toMatchObject({ status: 409 });
    expect(prismaMock.trackedLink.create).not.toHaveBeenCalled();
  });

  it("refuses two identical variants", async () => {
    await expect(
      startAbTest({
        ...input,
        b: { dmMessage: "  Mensagem atual ", linkButtonLabel: "Abrir", destinationUrl: "https://ATUAL.example/p/" },
      })
    ).rejects.toThrow(/iguais/);
  });

  it("needs a link for variant A when the campaign has none", async () => {
    prismaMock.automation.findFirst.mockResolvedValue({ ...campaign, trackedLinks: [] });
    await expect(startAbTest(input)).rejects.toThrow(/não tem link/);

    await startAbTest({ ...input, aDestinationUrl: "https://a-novo.example" });
    expect(prismaMock.abTest.create.mock.calls[0][0].data.aDestinationUrl).toBe("https://a-novo.example");
  });

  it("reports a campaign that is not in the workspace", async () => {
    prismaMock.automation.findFirst.mockResolvedValue(null);
    await expect(startAbTest(input)).rejects.toBeInstanceOf(AbTestError);
    await expect(startAbTest(input)).rejects.toMatchObject({ status: 404 });
  });
});

describe("endAbTest", () => {
  beforeEach(() => {
    prismaMock.abTest.findFirst.mockResolvedValue(runningTest());
    prismaMock.abTest.update.mockResolvedValue({ id: "test1", status: "ENDED" });
  });

  it("makes the winner's message, button and link the campaign's own", async () => {
    await endAbTest({ workspaceId: "ws1", automationId: "camp1", winner: "B" });

    expect(prismaMock.abTest.update).toHaveBeenCalledWith({
      where: { id: "test1" },
      data: expect.objectContaining({ status: "ENDED", winnerKey: "B" }),
    });
    expect(prismaMock.automation.update).toHaveBeenCalledWith({
      where: { id: "camp1" },
      data: { dmMessage: "Mensagem B", linkButtonLabel: "Quero" },
    });
    // The address as typed, not the one with UTM parameters.
    expect(syncMock).toHaveBeenCalledWith(prismaMock, {
      workspaceId: "ws1",
      automationId: "camp1",
      primaryUrl: "https://b.example/p",
    });
  });

  it("applies A when A wins", async () => {
    await endAbTest({ workspaceId: "ws1", automationId: "camp1", winner: "A" });
    expect(prismaMock.automation.update.mock.calls[0][0].data.dmMessage).toBe("Mensagem A");
    expect(syncMock.mock.calls[0][1].primaryUrl).toBe("https://a.example/p");
  });

  it("leaves the campaign alone when it ends without a winner", async () => {
    await endAbTest({ workspaceId: "ws1", automationId: "camp1", winner: null });
    expect(prismaMock.abTest.update.mock.calls[0][0].data.winnerKey).toBeNull();
    expect(prismaMock.automation.update).not.toHaveBeenCalled();
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("only looks at running tests of the person's own workspace", async () => {
    await endAbTest({ workspaceId: "ws1", automationId: "camp1", winner: null });
    expect(prismaMock.abTest.findFirst).toHaveBeenCalledWith({
      where: { automationId: "camp1", status: "RUNNING", automation: { workspaceId: "ws1" } },
    });
  });

  it("reports when there is nothing to end", async () => {
    prismaMock.abTest.findFirst.mockResolvedValue(null);
    await expect(endAbTest({ workspaceId: "ws1", automationId: "camp1", winner: "A" })).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("getAbPanelData", () => {
  it("returns null for a campaign that is not in the workspace", async () => {
    prismaMock.automation.findFirst.mockResolvedValue(null);
    await expect(getAbPanelData("ws1", "camp1")).resolves.toBeNull();
  });

  it("returns the campaign's current content when there is no test", async () => {
    prismaMock.automation.findFirst.mockResolvedValue(campaign);
    prismaMock.abTest.findFirst.mockResolvedValue(null);
    await expect(getAbPanelData("ws1", "camp1")).resolves.toEqual({
      test: null,
      defaults: { dmMessage: "Mensagem atual", linkButtonLabel: "Abrir", destinationUrl: "https://atual.example/p" },
    });
  });

  it("counts people once, ignores link-preview robots and reads sends per variant", async () => {
    prismaMock.automation.findFirst.mockResolvedValue(campaign);
    prismaMock.abTest.findFirst.mockResolvedValue(runningTest());
    prismaMock.dmLog.groupBy.mockResolvedValue([
      { abVariantKey: "A", _count: { _all: 200 } },
      { abVariantKey: "B", _count: { _all: 190 } },
    ]);
    prismaMock.linkClick.findMany.mockImplementation(async ({ where }: { where: { trackedLinkId: string } }) =>
      where.trackedLinkId === "linkA"
        ? [
            { recipientHash: "p1", ipHash: "ip1", userAgent: "Mozilla/5.0 Instagram" },
            { recipientHash: "p1", ipHash: "ip1", userAgent: "Mozilla/5.0 Instagram" }, // same person again
            { recipientHash: "p2", ipHash: "ip2", userAgent: "Mozilla/5.0" },
            { recipientHash: "p3", ipHash: "ip3", userAgent: "facebookexternalhit/1.1" }, // robot
          ]
        : [
            { recipientHash: null, ipHash: "ip9", userAgent: null },
            { recipientHash: null, ipHash: "ip9", userAgent: null }, // same address
            { recipientHash: "p7", ipHash: "ip7", userAgent: "Mozilla/5.0" },
          ]
    );

    const data = await getAbPanelData("ws1", "camp1");
    const [a, b] = data!.test!.variants;

    expect(a).toMatchObject({ key: "A", sent: 200, clicks: 3, clickers: 2, ratePercent: 1 });
    expect(b).toMatchObject({ key: "B", sent: 190, clicks: 3, clickers: 2, ratePercent: 1.1 });
    expect(data!.test).toMatchObject({ status: "RUNNING", weightA: 50, winnerKey: null });
    expect(data!.test!.summary.enough).toBe(true);
    expect(prismaMock.dmLog.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { abTestId: "test1", status: "SENT" } })
    );
  });

  it("shows an ended test with its winner", async () => {
    prismaMock.automation.findFirst.mockResolvedValue(campaign);
    prismaMock.abTest.findFirst.mockResolvedValue(
      runningTest({ status: "ENDED", winnerKey: "B", endedAt: new Date("2026-10-12T12:00:00Z") })
    );
    prismaMock.dmLog.groupBy.mockResolvedValue([]);
    prismaMock.linkClick.findMany.mockResolvedValue([]);

    const data = await getAbPanelData("ws1", "camp1");

    expect(data!.test).toMatchObject({ status: "ENDED", winnerKey: "B", endedAt: "2026-10-12T12:00:00.000Z" });
    expect(data!.test!.variants[0]).toMatchObject({ sent: 0, clicks: 0, ratePercent: 0 });
  });
});
