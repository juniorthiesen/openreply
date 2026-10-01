import { describe, expect, it } from "vitest";
import { buildScheduleSlots, normalizeFilename, parseCaptionCsv } from "../components/scheduling/bulk-utils";

describe("buildScheduleSlots", () => {
  it("distributes posts on the selected weekdays", () => {
    expect(buildScheduleSlots(3, "2026-07-03", "12:30", "mon-wed-fri", false)).toEqual([
      "2026-07-03T12:30",
      "2026-07-06T12:30",
      "2026-07-08T12:30",
    ]);
  });

  it("skips weekends when requested", () => {
    expect(buildScheduleSlots(3, "2026-07-03", "09:00", "daily", true)).toEqual([
      "2026-07-03T09:00",
      "2026-07-06T09:00",
      "2026-07-07T09:00",
    ]);
  });

  it("returns no slots for invalid form values", () => {
    expect(buildScheduleSlots(2, "", "12:00", "daily", false)).toEqual([]);
  });
});

describe("parseCaptionCsv", () => {
  it("matches quoted captions by filename and supports semicolon CSV", () => {
    const result = parseCaptionCsv('arquivo;legenda\r\n"ensaio/foto-01.jpg";"Legenda com; detalhe"\r\nfoto-02.png;"Linha 1\nlinha 2"');
    expect(result.get("foto-01.jpg")).toBe("Legenda com; detalhe");
    expect(result.get("foto-02.png")).toBe("Linha 1\nlinha 2");
    expect(normalizeFilename("ensaio\\FOTO-01.jpg")).toBe("foto-01.jpg");
  });

  it("rejects CSV files without the required column names", () => {
    expect(parseCaptionCsv("post,texto\nfoto.jpg,Legenda")).toEqual(new Map());
  });
});
