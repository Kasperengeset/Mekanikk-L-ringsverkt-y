/**
 * Egenlagde eksempelmodeller for utvikling og skjermbilder (ikke kursoppgaver, siden repoet er offentlig).
 * Velg i appen med ?eksempel=<navn>, eller i `pnpm snapshot --fixture <navn>`.
 */
import { Model, type ModelInput } from "../core/schema";
import bjelke from "../../testset/ex-bjelke-figur/truth.json";
import fagverk from "../../testset/ex-fagverk-tekst/truth.json";
import ramme from "../../testset/ex-ramme-tekst/truth.json";

const m = (input: Omit<ModelInput, "schemaVersion" | "units"> & Partial<Pick<ModelInput, "units">>) =>
  Model.parse({ schemaVersion: 1, units: { length: "m", force: "kN" }, ...input });
const q = (member: string, w: number, basis: "length" | "projection" = "length") =>
  ({ id: `q_${member}`, type: "distributed", member, w_start: w, w_end: w, from: 0, to: 1, direction: "global_y", basis }) as const;

export const FIXTURES: Record<string, { title: string; model: Model }> = {
  bjelke: { title: "Fritt opplagt bjelke med punktlast", model: Model.parse(bjelke) },
  ramme: { title: "Portalramme, statisk ubestemt", model: Model.parse(ramme) },
  fagverk: { title: "Trekantfagverk", model: Model.parse(fagverk) },
  gerber: {
    title: "Gerberbjelke med ledd",
    model: m({
      nodes: [
        { id: "A", x: 0, y: 0 },
        { id: "H", x: 3, y: 0 },
        { id: "P", x: 5, y: 0 },
        { id: "C", x: 7, y: 0 },
      ],
      members: [
        { id: "AH", i: "A", j: "H", kind: "beam", release: { i: false, j: true } },
        { id: "HP", i: "H", j: "P", kind: "beam" },
        { id: "PC", i: "P", j: "C", kind: "beam" },
      ],
      supports: [
        { node: "A", type: "fixed" },
        { node: "C", type: "roller", angle_deg: 0 },
      ],
      loads: [q("AH", -2), q("HP", -2), q("PC", -2), { id: "P1", type: "point", node: "P", P: 6, angle_deg: -90 }],
      asked: [{ quantity: "diagrams" }],
    }),
  },
  skraa: {
    title: "Bjelke med skrått rullelager, skrå last og moment",
    model: m({
      nodes: [
        { id: "A", x: 0, y: 0 },
        { id: "B", x: 5, y: 0 },
      ],
      members: [{ id: "AB", i: "A", j: "B", kind: "beam" }],
      supports: [
        { node: "A", type: "pinned" },
        { node: "B", type: "roller", angle_deg: 30 },
      ],
      loads: [
        { id: "P1", type: "point", member: "AB", at: 0.4, P: 8, angle_deg: -135 },
        { id: "M1", type: "moment", member: "AB", at: 0.8, M: 4 },
      ],
      asked: [{ quantity: "reaction", node: "A" }, { quantity: "reaction", node: "B" }],
    }),
  },
  treledd: {
    title: "Treleddsramme med snølast per horisontal lengde",
    model: m({
      nodes: [
        { id: "A", x: 0, y: 0 },
        { id: "B", x: 0, y: 3 },
        { id: "C", x: 4, y: 5 },
        { id: "D", x: 8, y: 3 },
        { id: "E", x: 8, y: 0 },
      ],
      members: [
        { id: "AB", i: "A", j: "B", kind: "beam" },
        { id: "BC", i: "B", j: "C", kind: "beam", release: { i: false, j: true } },
        { id: "CD", i: "C", j: "D", kind: "beam" },
        { id: "DE", i: "D", j: "E", kind: "beam" },
      ],
      supports: [
        { node: "A", type: "pinned" },
        { node: "E", type: "pinned" },
      ],
      loads: [q("BC", -10, "projection"), q("CD", -10, "projection")],
      asked: [{ quantity: "diagrams" }],
    }),
  },
  symbolsk: {
    title: "Bjelke med utstikk, symbolsk (F, L)",
    model: m({
      nodes: [
        { id: "A", x: 0, y: 0 },
        { id: "B", x: 1, y: 0 },
        { id: "C", x: 1.5, y: 0 },
      ],
      members: [
        { id: "AB", i: "A", j: "B", kind: "beam" },
        { id: "BC", i: "B", j: "C", kind: "beam" },
      ],
      supports: [
        { node: "A", type: "pinned" },
        { node: "B", type: "roller", angle_deg: 0 },
      ],
      loads: [{ id: "F", type: "point", node: "C", P: 1, angle_deg: -90 }],
      asked: [{ quantity: "M_max" }],
      symbols: [
        { name: "F", kind: "force" },
        { name: "L", kind: "length" },
      ],
    }),
  },
  utkrager: {
    title: "Utkrager i IPE200 (kvantitativ deformasjon)",
    model: m({
      nodes: [
        { id: "A", x: 0, y: 0 },
        { id: "B", x: 4, y: 0 },
      ],
      sections: [{ id: "S", E: 210e9, shape: { type: "profile", name: "IPE200", axis: "strong" }, assumed: false }],
      members: [{ id: "AB", i: "A", j: "B", kind: "beam", section: "S" }],
      supports: [{ node: "A", type: "fixed" }],
      loads: [q("AB", -3), { id: "P1", type: "point", node: "B", P: 5, angle_deg: -90 }],
      asked: [{ quantity: "displacement", node: "B" }],
    }),
  },
};

export function fixtureFromUrl(search: string): Model | undefined {
  const name = new URLSearchParams(search).get("eksempel");
  return name ? FIXTURES[name]?.model : undefined;
}
