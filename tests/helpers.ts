import { Model, type ModelInput } from "../src/core/schema";

/** Bygger en gyldig modell; schemaVersion og enheter (m, kN) fylles inn hvis de mangler. */
export function model(input: Omit<ModelInput, "schemaVersion" | "units"> & Partial<Pick<ModelInput, "units">>): Model {
  return Model.parse({ schemaVersion: 1, units: { length: "m", force: "kN" }, ...input });
}

/** Fritt opplagt bjelke A–B (6 m) med jevnt fordelt last og punktlast 2 m fra A. */
export function simpleBeam(): Model {
  return model({
    nodes: [
      { id: "A", x: 0, y: 0 },
      { id: "B", x: 6, y: 0 },
    ],
    members: [{ id: "AB", i: "A", j: "B", kind: "beam" }],
    supports: [
      { node: "A", type: "pinned" },
      { node: "B", type: "roller", angle_deg: 0 },
    ],
    loads: [
      { id: "q", type: "distributed", member: "AB", w_start: -4, w_end: -4, from: 0, to: 1, direction: "global_y", basis: "length" },
      { id: "P", type: "point", member: "AB", at: 1 / 3, P: 10, angle_deg: -90 },
    ],
  });
}
