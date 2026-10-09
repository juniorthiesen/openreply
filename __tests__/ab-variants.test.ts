import { describe, expect, it } from "vitest";
import {
  applyAbVariant,
  clampWeightA,
  pickVariantKey,
  resolveVariantKey,
  withUtmParams,
  type AbTestForWorker,
} from "@/lib/ab/variants";
import {
  clickRate,
  MIN_SENT_PER_VARIANT,
  probabilityBBeatsA,
  summarizeAbTest,
} from "@/lib/ab/stats";

const test: AbTestForWorker = {
  id: "test1",
  weightA: 50,
  aDmMessage: "Mensagem A",
  aLinkButtonLabel: "Quero A",
  aTrackedLink: { slug: "slugA", label: "Teste A/B: variante A", destinationUrl: "https://a.example/?utm_content=variante-a" },
  bDmMessage: "Mensagem B",
  bLinkButtonLabel: null,
  bTrackedLink: { slug: "slugB", label: "Teste A/B: variante B", destinationUrl: "https://b.example/?utm_content=variante-b" },
};

describe("pickVariantKey", () => {
  it("gives the same person the same variant every time", () => {
    const first = pickVariantKey("test1", "person-42", 50);
    for (let i = 0; i < 20; i++) expect(pickVariantKey("test1", "person-42", 50)).toBe(first);
  });

  it.each([50, 30, 70])("splits people close to %i/%i", (weightA) => {
    let a = 0;
    const total = 10_000;
    for (let i = 0; i < total; i++) if (pickVariantKey("test1", `person-${i}`, weightA) === "A") a++;
    expect(a / total).toBeGreaterThan(weightA / 100 - 0.03);
    expect(a / total).toBeLessThan(weightA / 100 + 0.03);
  });

  it("assigns differently in different tests, so a person is not stuck with A forever", () => {
    let differ = 0;
    for (let i = 0; i < 200; i++) {
      if (pickVariantKey("test1", `person-${i}`, 50) !== pickVariantKey("test2", `person-${i}`, 50)) differ++;
    }
    expect(differ).toBeGreaterThan(50);
  });

  it("sends everyone to one side at the extremes", () => {
    for (let i = 0; i < 100; i++) {
      expect(pickVariantKey("test1", `p${i}`, 100)).toBe("A");
      expect(pickVariantKey("test1", `p${i}`, 0)).toBe("B");
    }
  });
});

describe("clampWeightA", () => {
  it("keeps the split between 10 and 90", () => {
    expect(clampWeightA(0)).toBe(10);
    expect(clampWeightA(100)).toBe(90);
    expect(clampWeightA(55.4)).toBe(55);
    expect(clampWeightA(Number.NaN)).toBe(50);
  });
});

describe("resolveVariantKey", () => {
  it("keeps the variant already logged for this test", () => {
    // Pick the opposite of what the hash would give, to prove the log wins.
    const hashed = pickVariantKey("test1", "person-1", 50);
    const logged = hashed === "A" ? "B" : "A";
    expect(resolveVariantKey(test, "person-1", { abTestId: "test1", abVariantKey: logged })).toBe(logged);
  });

  it("ignores a log from another test or with an invalid key", () => {
    const hashed = pickVariantKey("test1", "person-1", 50);
    const other = hashed === "A" ? "B" : "A";
    expect(resolveVariantKey(test, "person-1", { abTestId: "other", abVariantKey: other })).toBe(hashed);
    expect(resolveVariantKey(test, "person-1", { abTestId: "test1", abVariantKey: "Z" })).toBe(hashed);
    expect(resolveVariantKey(test, "person-1", null)).toBe(hashed);
  });
});

describe("applyAbVariant", () => {
  const campaign = {
    id: "campaign1",
    dmMessage: "Original",
    linkButtonLabel: "Original botao",
    trackedLinks: [{ slug: "primary", label: null, destinationUrl: "https://original.example" }],
    followUpEnabled: true,
  };

  it("swaps the message, the button and the link for the variant's", () => {
    const a = applyAbVariant(campaign, test, "A");
    expect(a).toMatchObject({ id: "campaign1", followUpEnabled: true, dmMessage: "Mensagem A", linkButtonLabel: "Quero A" });
    expect(a.trackedLinks).toEqual([test.aTrackedLink]);

    const b = applyAbVariant(campaign, test, "B");
    expect(b).toMatchObject({ dmMessage: "Mensagem B", linkButtonLabel: null });
    expect(b.trackedLinks).toEqual([test.bTrackedLink]);
  });

  it("does not change the campaign it was given", () => {
    applyAbVariant(campaign, test, "B");
    expect(campaign.dmMessage).toBe("Original");
    expect(campaign.trackedLinks[0].slug).toBe("primary");
  });

  it("sends a plain message when the variant has no link", () => {
    const result = applyAbVariant(campaign, { ...test, bTrackedLink: null }, "B");
    expect(result.trackedLinks).toEqual([]);
  });
});

describe("withUtmParams", () => {
  it("adds the four UTM parameters", () => {
    const url = new URL(withUtmParams("https://loja.example/produto", "B", "camp1"));
    expect(url.searchParams.get("utm_source")).toBe("fisga");
    expect(url.searchParams.get("utm_medium")).toBe("instagram_dm");
    expect(url.searchParams.get("utm_campaign")).toBe("ab-camp1");
    expect(url.searchParams.get("utm_content")).toBe("variante-b");
  });

  it("keeps parameters that are already there and the rest of the address", () => {
    const url = new URL(withUtmParams("https://loja.example/p?ref=bio&utm_source=meu", "A", "camp1"));
    expect(url.searchParams.get("ref")).toBe("bio");
    expect(url.searchParams.get("utm_source")).toBe("meu");
    expect(url.searchParams.get("utm_content")).toBe("variante-a");
  });

  it("returns an address it cannot parse unchanged", () => {
    expect(withUtmParams("não é url", "A", "camp1")).toBe("não é url");
  });
});

describe("probabilityBBeatsA", () => {
  it("has no answer until both variants have sends", () => {
    expect(probabilityBBeatsA({ sent: 0, clickers: 0 }, { sent: 10, clickers: 2 })).toBeNull();
    expect(probabilityBBeatsA({ sent: 10, clickers: 2 }, { sent: 0, clickers: 0 })).toBeNull();
  });

  it("is about even for equal results", () => {
    const p = probabilityBBeatsA({ sent: 200, clickers: 40 }, { sent: 200, clickers: 40 });
    expect(p).toBeGreaterThan(0.45);
    expect(p).toBeLessThan(0.55);
  });

  it("is high when B is clearly better and low when A is", () => {
    expect(probabilityBBeatsA({ sent: 300, clickers: 30 }, { sent: 300, clickers: 60 })).toBeGreaterThan(0.99);
    expect(probabilityBBeatsA({ sent: 300, clickers: 60 }, { sent: 300, clickers: 30 })).toBeLessThan(0.01);
  });

  it("is symmetrical when the variants swap places", () => {
    const a = { sent: 150, clickers: 30 };
    const b = { sent: 130, clickers: 40 };
    const forward = probabilityBBeatsA(a, b) as number;
    const backward = probabilityBBeatsA(b, a) as number;
    expect(forward + backward).toBeCloseTo(1, 5);
  });

  it("does not treat a tiny sample as certain", () => {
    const p = probabilityBBeatsA({ sent: 10, clickers: 1 }, { sent: 10, clickers: 4 }) as number;
    expect(p).toBeLessThan(0.95);
  });
});

describe("clickRate", () => {
  it("is zero without sends and never above one", () => {
    expect(clickRate({ sent: 0, clickers: 0 })).toBe(0);
    expect(clickRate({ sent: 4, clickers: 9 })).toBe(1);
    expect(clickRate({ sent: 200, clickers: 50 })).toBe(0.25);
  });
});

describe("summarizeAbTest", () => {
  it("says there is nothing to read before any DM is sent", () => {
    const summary = summarizeAbTest({ sent: 0, clickers: 0 }, { sent: 0, clickers: 0 });
    expect(summary).toMatchObject({ leader: null, enough: false, decisive: false });
    expect(summary.verdict).toMatch(/Ainda não há DMs/);
  });

  it("asks for more data below the minimum, naming the counts", () => {
    const summary = summarizeAbTest({ sent: 40, clickers: 4 }, { sent: 60, clickers: 12 });
    expect(summary.enough).toBe(false);
    expect(summary.decisive).toBe(false);
    expect(summary.leader).toBe("B");
    expect(summary.verdict).toContain(`${MIN_SENT_PER_VARIANT}`);
    expect(summary.verdict).toContain("A tem 40");
    expect(summary.verdict).toContain("B tem 60");
  });

  it("calls a clear winner only with enough data", () => {
    const summary = summarizeAbTest({ sent: 300, clickers: 30 }, { sent: 300, clickers: 70 });
    expect(summary).toMatchObject({ leader: "B", enough: true, decisive: true });
    expect(summary.verdict).toMatch(/^B tem \d+% de chance de ser melhor que A\.$/);
    expect(summary.verdict).not.toContain("100%");
  });

  it("names A when A is the clear winner", () => {
    const summary = summarizeAbTest({ sent: 300, clickers: 90 }, { sent: 300, clickers: 40 });
    expect(summary).toMatchObject({ leader: "A", decisive: true });
    expect(summary.verdict).toMatch(/^A tem/);
  });

  it("does not decide when the gap is small", () => {
    const summary = summarizeAbTest({ sent: 150, clickers: 30 }, { sent: 150, clickers: 33 });
    expect(summary).toMatchObject({ enough: true, decisive: false });
    expect(summary.verdict).toMatch(/Ainda não dá para dizer/);
  });

  it("reports a tie", () => {
    const summary = summarizeAbTest({ sent: 200, clickers: 40 }, { sent: 200, clickers: 40 });
    expect(summary.leader).toBeNull();
    expect(summary.verdict).toMatch(/empatadas/);
  });
});
