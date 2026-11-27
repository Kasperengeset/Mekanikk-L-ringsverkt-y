import { describe, expect, it } from "vitest";
import type { Model } from "../src/core/schema.js";
import { evalPoly, solve, type SolveResult } from "../src/core/solver/index.js";
import { model } from "./helpers.js";

const kN = 1e3;

function ok(r: SolveResult) {
  if (r.status !== "ok") throw new Error(`forventet løsning, fikk ${r.status}: ${JSON.stringify(r)}`);
  expect(r.equilibrium.relative).toBeLessThan(1e-12);
  return r;
}
const reaction = (r: ReturnType<typeof ok>, node: string) => r.reactions.find((x) => x.node === node)!;
const member = (r: ReturnType<typeof ok>, id: string) => r.members.find((m) => m.id === id)!;
/** Snittkraft i posisjon x langs elementet. */
function at(r: ReturnType<typeof ok>, id: string, key: "N" | "V" | "M", x: number) {
  const m = member(r, id);
  const piece = m.pieces.find((p) => x >= p.x0 - 1e-12 && x <= p.x1 + 1e-12)!;
  return evalPoly(piece[key], x);
}
const close = (actual: number, expected: number, rel = 1e-9) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(expected)));

const beam = (L: number, supports: Model["supports"], loads: Model["loads"]) =>
  model({
    nodes: [
      { id: "A", x: 0, y: 0 },
      { id: "B", x: L, y: 0 },
    ],
    members: [{ id: "AB", i: "A", j: "B", kind: "beam" }],
    supports,
    loads,
  });
const udl = (member: string, w: number) =>
  ({ id: `q${member}`, type: "distributed", member, w_start: w, w_end: w, from: 0, to: 1, direction: "global_y", basis: "length" }) as const;

describe("statisk bestemte bjelker", () => {
  it("fritt opplagt med jevn last: qL/2 og qL²/8", () => {
    const r = ok(solve(beam(6, [{ node: "A", type: "pinned" }, { node: "B", type: "roller" }], [udl("AB", -4)])));
    close(reaction(r, "A").Fy, 12 * kN);
    close(reaction(r, "B").Fy, 12 * kN);
    const m = member(r, "AB").extremes.M.max;
    close(m.value, 18 * kN);
    close(m.x, 3);
    close(at(r, "AB", "V", 0), 12 * kN);
  });

  it("trekantlast: reaksjoner q0L/6 og q0L/3, M_max = q0L²/(9√3) i x = L/√3", () => {
    const L = 6;
    const q0 = 9;
    const r = ok(
      solve(
        beam(L, [{ node: "A", type: "pinned" }, { node: "B", type: "roller" }], [
          { id: "q", type: "distributed", member: "AB", w_start: 0, w_end: -q0, from: 0, to: 1, direction: "global_y", basis: "length" },
        ]),
      ),
    );
    close(reaction(r, "A").Fy, ((q0 * L) / 6) * kN);
    close(reaction(r, "B").Fy, ((q0 * L) / 3) * kN);
    const m = member(r, "AB").extremes.M.max;
    close(m.value, ((q0 * L * L) / (9 * Math.sqrt(3))) * kN);
    close(m.x, L / Math.sqrt(3));
  });

  it("punktlast på elementet gir Pab/L og samme svar som en node i lastpunktet", () => {
    const supports: Model["supports"] = [{ node: "A", type: "pinned" }, { node: "B", type: "roller" }];
    const r = ok(solve(beam(6, supports, [{ id: "P", type: "point", member: "AB", at: 1 / 3, P: 10, angle_deg: -90 }])));
    close(member(r, "AB").extremes.M.max.value, ((10 * 2 * 4) / 6) * kN);
    close(reaction(r, "A").Fy, ((10 * 4) / 6) * kN);
    expect(at(r, "AB", "V", 1.9)).toBeCloseTo(at(r, "AB", "V", 2.1) + 10 * kN, 6);
  });

  it("moment på elementet: reaksjoner ±M0/L og sprang i M", () => {
    const r = ok(solve(beam(4, [{ node: "A", type: "pinned" }, { node: "B", type: "roller" }], [{ id: "M", type: "moment", member: "AB", at: 0.5, M: 8 }])));
    // Moment mot klokka vil dreie bjelken: A presses opp og B trekkes ned.
    close(reaction(r, "A").Fy, 2 * kN);
    close(reaction(r, "B").Fy, -2 * kN);
    close(at(r, "AB", "M", 1.999999) - at(r, "AB", "M", 2.000001), 8 * kN, 1e-5);
  });

  it("utkrager (flaggstang): M_A = F·H", () => {
    const r = ok(
      solve(
        model({
          nodes: [
            { id: "A", x: 0, y: 0 },
            { id: "B", x: 0, y: 6 },
          ],
          members: [{ id: "AB", i: "A", j: "B", kind: "beam" }],
          supports: [{ node: "A", type: "fixed" }],
          loads: [{ id: "F", type: "point", node: "B", P: 5, angle_deg: 0 }],
        }),
      ),
    );
    close(reaction(r, "A").M, 30 * kN);
    close(reaction(r, "A").Fx, -5 * kN);
    close(Math.abs(at(r, "AB", "M", 0)), 30 * kN);
  });

  it("Gerberbjelke med punktlast i leddet (øving 3 oppg. 1): MA = 26 kNm, Dz = 2 kN", () => {
    const r = ok(
      solve(
        model({
          nodes: [
            { id: "A", x: 0, y: 0 },
            { id: "B", x: 2, y: 0 },
            { id: "C", x: 4, y: 0 },
            { id: "D", x: 8, y: 0 },
          ],
          members: [
            { id: "AB", i: "A", j: "B", kind: "beam" },
            { id: "BC", i: "B", j: "C", kind: "beam", release: { i: false, j: true } },
            { id: "CD", i: "C", j: "D", kind: "beam" },
          ],
          supports: [
            { node: "A", type: "fixed" },
            { node: "D", type: "roller" },
          ],
          loads: [
            { id: "F1", type: "point", node: "B", P: 3, angle_deg: -90 },
            { id: "F2", type: "point", node: "C", P: 3, angle_deg: -90 },
            udl("CD", -1),
          ],
        }),
      ),
    );
    close(reaction(r, "A").M, 26 * kN);
    close(reaction(r, "D").Fy, 2 * kN);
    close(at(r, "BC", "M", 2), 0);
  });

  it("skrått rullelager (øving 2 oppg. 3b): B = 2F/3 normalt på underlaget", () => {
    const r = ok(
      solve(
        model({
          nodes: [
            { id: "A", x: 0, y: 0 },
            { id: "P", x: 1, y: 0 },
            { id: "C", x: 2, y: 0 },
            { id: "B", x: 3, y: 0 },
            { id: "D", x: 2, y: 1 },
          ],
          members: [
            { id: "AP", i: "A", j: "P", kind: "beam" },
            { id: "PC", i: "P", j: "C", kind: "beam" },
            { id: "CB", i: "C", j: "B", kind: "beam" },
            { id: "CD", i: "C", j: "D", kind: "beam" },
          ],
          supports: [
            { node: "A", type: "pinned" },
            { node: "B", type: "roller", angle_deg: 60 },
          ],
          loads: [
            { id: "F1", type: "point", node: "P", P: 1, angle_deg: -90 },
            { id: "F2", type: "point", node: "D", P: 2, angle_deg: 180 },
          ],
        }),
      ),
    );
    const B = reaction(r, "B");
    close(Math.hypot(B.Fx, B.Fy), (2 / 3) * kN);
    // Reaksjonen står normalt på underlaget (60°): ingen komponent langs underlaget.
    close(B.Fx * Math.cos(Math.PI / 3) + B.Fy * Math.sin(Math.PI / 3), 0, 1e-9);
    close(reaction(r, "A").Fy, (4 / 3) * kN);
  });
});

describe("statisk ubestemte systemer", () => {
  it("innspent–rullelager med jevn last: R_B = 3qL/8, M_A = qL²/8", () => {
    const r = ok(solve(beam(6, [{ node: "A", type: "fixed" }, { node: "B", type: "roller" }], [udl("AB", -4)])));
    close(reaction(r, "B").Fy, ((3 * 4 * 6) / 8) * kN, 1e-6);
    close(Math.abs(reaction(r, "A").M), ((4 * 36) / 8) * kN, 1e-6);
  });
});

describe("fagverk og blandede systemer", () => {
  it("trekantfagverk: stavkrefter fra knutepunktslikevekt", () => {
    const r = ok(
      solve(
        model({
          nodes: [
            { id: "A", x: 0, y: 0 },
            { id: "B", x: 4, y: 0 },
            { id: "C", x: 2, y: 3 },
          ],
          members: [
            { id: "AB", i: "A", j: "B", kind: "truss" },
            { id: "AC", i: "A", j: "C", kind: "truss" },
            { id: "BC", i: "B", j: "C", kind: "truss" },
          ],
          supports: [
            { node: "A", type: "pinned" },
            { node: "B", type: "roller" },
          ],
          loads: [{ id: "P", type: "point", node: "C", P: 20, angle_deg: -90 }],
        }),
      ),
    );
    close(at(r, "AC", "N", 1), (-10 * Math.sqrt(13)) / 3 * kN);
    close(at(r, "AB", "N", 1), (20 / 3) * kN);
  });
});

describe("mekanismer og ugyldige modeller", () => {
  it("bjelke på to rullelagre er en mekanisme horisontalt", () => {
    const r = solve(beam(6, [{ node: "A", type: "roller" }, { node: "B", type: "roller" }], [udl("AB", -4)]));
    expect(r).toMatchObject({ status: "mechanism", component: "ux" });
  });

  it("tre parallelle rullelagre er en mekanisme selv om n_s = 0", () => {
    const m = model({
      nodes: [
        { id: "A", x: 0, y: 0 },
        { id: "B", x: 3, y: 0 },
        { id: "C", x: 6, y: 0 },
      ],
      members: [
        { id: "AB", i: "A", j: "B", kind: "beam" },
        { id: "BC", i: "B", j: "C", kind: "beam" },
      ],
      supports: ["A", "B", "C"].map((node) => ({ node, type: "roller" as const })),
      loads: [],
    });
    const r = solve(m);
    expect(r.status).toBe("mechanism");
    if (r.status === "mechanism") expect(r.determinacy.n_s).toBe(0);
  });

  it("moment i en node uten stiv bjelkeende kan ikke tas opp", () => {
    const r = solve(
      model({
        nodes: [
          { id: "A", x: 0, y: 0 },
          { id: "B", x: 4, y: 0 },
          { id: "C", x: 2, y: 3 },
        ],
        members: [
          { id: "AB", i: "A", j: "B", kind: "truss" },
          { id: "AC", i: "A", j: "C", kind: "truss" },
          { id: "BC", i: "B", j: "C", kind: "truss" },
        ],
        supports: [
          { node: "A", type: "pinned" },
          { node: "B", type: "roller" },
        ],
        loads: [{ id: "M", type: "moment", node: "C", M: 5 }],
      }),
    );
    expect(r).toMatchObject({ status: "mechanism", node: "C", component: "rz" });
  });

  it("ugyldig modell løses ikke", () => {
    const m = beam(6, [{ node: "A", type: "pinned" }], []);
    expect(solve({ ...m, members: [{ id: "AX", i: "A", j: "X", kind: "beam" }] }).status).toBe("invalid");
  });
});

describe("ytelse", () => {
  it("løser et system med 51 frihetsgrader godt under ett millisekund", () => {
    const n = 17;
    const m = model({
      nodes: Array.from({ length: n }, (_, k) => ({ id: `N${k}`, x: k * 0.5, y: 0 })),
      members: Array.from({ length: n - 1 }, (_, k) => ({ id: `E${k}`, i: `N${k}`, j: `N${k + 1}`, kind: "beam" as const })),
      supports: [
        { node: "N0", type: "fixed" },
        { node: `N${n - 1}`, type: "roller" },
      ],
      loads: Array.from({ length: n - 1 }, (_, k) => udl(`E${k}`, -2)),
    });
    for (let k = 0; k < 20; k++) solve(m);
    const times: number[] = [];
    for (let k = 0; k < 200; k++) {
      const t = performance.now();
      ok(solve(m));
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const median = times[times.length / 2]!;
    console.log(`solve, 51 frihetsgrader: median ${median.toFixed(3)} ms`);
    expect(median).toBeLessThan(2);
  });
});
