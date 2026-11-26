import { describe, expect, it } from "vitest";
import { validateModel } from "../src/core/validate";
import { loadTestset } from "../eval/testset";

const { cases, errors } = await loadTestset();

describe("testsettet", () => {
  it("alle mapper i testset/ kan leses", () => {
    expect(errors).toEqual([]);
  });

  it.each(cases.map((c) => [c.id, c] as const))("%s har en gyldig fasitmodell", (_id, c) => {
    const v = validateModel(c.truth);
    expect(v.issues.filter((i) => i.level === "error")).toEqual([]);
  });
});
