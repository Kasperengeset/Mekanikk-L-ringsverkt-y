import { describe, expect, it } from "vitest";
import { Model, SubmitModelInput, toLlmJsonSchema } from "../src/core/schema";

function walk(node: unknown, visit: (obj: Record<string, unknown>) => void) {
  if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
  else if (node && typeof node === "object") {
    visit(node as Record<string, unknown>);
    Object.values(node).forEach((n) => walk(n, visit));
  }
}

describe("schema", () => {
  it("JSON Schema for submit_model passer strict tool use", () => {
    const schema = toLlmJsonSchema(SubmitModelInput);
    const forbidden = ["$schema", "default", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "oneOf"];
    walk(schema, (obj) => {
      for (const key of forbidden) expect(obj, `nøkkelordet ${key}`).not.toHaveProperty(key);
      if (obj.type === "object") expect(obj.additionalProperties).toBe(false);
    });
  });

  it("felt med standardverdi er påkrevd i LLM-skjemaet", () => {
    const schema = toLlmJsonSchema(SubmitModelInput) as { properties: { model: { required: string[] } } };
    expect(schema.properties.model.required).toEqual(
      expect.arrayContaining(["sections", "asked", "provenance", "supports", "loads"]),
    );
  });

  it("godtar eksemplet fra spesifikasjonen (tilpasset P/vinkel og retning på fordelt last)", () => {
    const parsed = Model.parse({
      schemaVersion: 1,
      units: { length: "m", force: "kN" },
      nodes: [
        { id: "A", x: 0, y: 0 },
        { id: "B", x: 4, y: 0 },
      ],
      members: [{ id: "AB", i: "A", j: "B", kind: "beam", section: "S1", release: { i: false, j: false } }],
      sections: [{ id: "S1", E: 210e9, A: 5.4e-3, I: 8.4e-5, assumed: true }],
      supports: [
        { node: "A", type: "fixed" },
        { node: "B", type: "roller", angle_deg: 0 },
      ],
      loads: [
        { id: "q1", type: "distributed", member: "AB", w_start: -2, w_end: -2, from: 0, to: 1, direction: "global_y", basis: "length" },
        { id: "P1", type: "point", node: "B", P: 10, angle_deg: -90 },
        { id: "M1", type: "moment", node: "B", M: 5 },
      ],
      asked: [
        { quantity: "reaction", node: "A" },
        { quantity: "M_max", member: "AB" },
      ],
      provenance: [{ entity_kind: "support", entity: "B", confidence: 0.62, note: "Symbolet kan være rullelager eller glidelager" }],
    });
    expect(parsed.loads).toHaveLength(3);
  });

  it("en utelatt questions-liste godtas som tom, men er påkrevd i LLM-skjemaet", () => {
    const schema = toLlmJsonSchema(SubmitModelInput) as { required: string[] };
    expect(schema.required).toContain("questions");
    const parsed = SubmitModelInput.parse({
      model: { schemaVersion: 1, units: { length: "m", force: "kN" }, nodes: [{ id: "A", x: 0, y: 0 }], members: [], supports: [], loads: [] },
    });
    expect(parsed.questions).toEqual([]);
  });

  it("avviser ukjente felt", () => {
    expect(() =>
      Model.parse({ schemaVersion: 1, units: { length: "m", force: "kN" }, nodes: [{ id: "A", x: 0, y: 0, z: 1 }], members: [], supports: [], loads: [] }),
    ).toThrow();
  });
});
