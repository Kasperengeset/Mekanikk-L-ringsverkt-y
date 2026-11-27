import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderPdfInNode } from "../server/pdf.js";
import { CLAUDE_MAX_LONG_EDGE, CLAUDE_MAX_PIXELS, pageScale } from "../src/pdf/render.js";

const A4 = [595.28, 841.89] as const;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

describe("pageScale", () => {
  it("A4 begrenses av antall piksler, ikke langsiden", () => {
    const s = pageScale(...A4);
    expect(A4[0] * s * A4[1] * s).toBeCloseTo(CLAUDE_MAX_PIXELS, -3);
    expect(A4[1] * s).toBeLessThan(CLAUDE_MAX_LONG_EDGE);
  });

  it("en lang, smal side begrenses av langsiden", () => {
    expect(2000 * pageScale(2000, 200)).toBeCloseTo(CLAUDE_MAX_LONG_EDGE);
  });

  it("en liten side blåses ikke opp over 300 dpi", () => {
    expect(pageScale(100, 100)).toBeCloseTo(300 / 72);
  });
});

describe("renderPdfInNode", () => {
  const pdf = readFileSync("testset/ex-bjelke-pdf/oppgave.pdf");

  it("rendrer en A4-side innenfor Claudes bildegrenser", async () => {
    const [page, ...rest] = await renderPdfInNode(pdf);
    expect(rest).toHaveLength(0);
    expect(page!.page).toBe(1);
    expect(page!.width * page!.height).toBeLessThanOrEqual(CLAUDE_MAX_PIXELS);
    expect(Math.max(page!.width, page!.height)).toBeLessThanOrEqual(CLAUDE_MAX_LONG_EDGE);
    expect(page!.height / page!.width).toBeCloseTo(A4[1] / A4[0], 2);
    expect([...page!.png.slice(0, 4)]).toEqual(PNG_SIGNATURE);
  });

  it("avviser sider som ikke finnes", async () => {
    await expect(renderPdfInNode(pdf, { pages: [2] })).rejects.toThrow("Siden 2 finnes ikke");
  });
});
