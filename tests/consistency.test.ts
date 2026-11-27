import { describe, expect, it } from "vitest";
import { applyDisagreements, selectConsensus } from "../src/core/consistency.js";
import { simpleBeam } from "./helpers.js";

describe("self-consistency", () => {
  const good = simpleBeam();
  const wrongSupport = { ...good, supports: [good.supports[0]!, { node: "B", type: "pinned" as const }] };
  const missingLoad = { ...good, loads: good.loads.slice(0, 1) };

  it("velger tolkningen de andre er mest enige i", () => {
    expect(selectConsensus([wrongSupport, good, good]).index).toBe(1);
  });

  it("markerer uenighet som lav sikkerhet og spør om det som kan mangle", () => {
    const { index, disagreements } = selectConsensus([missingLoad, good, wrongSupport]);
    expect(index).toBe(1);
    expect(disagreements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "support", ids: ["B"], votes: 1 }),
        expect.objectContaining({ kind: "load", ids: ["P"], votes: 1 }),
      ]),
    );
    const applied = applyDisagreements(good, disagreements, 3);
    expect(applied.model.provenance.filter((p) => p.confidence < 0.7).map((p) => p.entity).sort()).toEqual(["B", "P"]);
  });

  it("lager spørsmål når den valgte tolkningen mangler noe de andre har", () => {
    const { index, disagreements } = selectConsensus([missingLoad, missingLoad, good]);
    expect(index).toBe(0);
    const applied = applyDisagreements(missingLoad, disagreements, 3);
    expect(applied.questions).toHaveLength(1);
    expect(applied.questions[0]).toContain("en last");
  });
});
