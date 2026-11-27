/**
 * Port 2: løseren mot en uavhengig referanse (anaStruct) for hver oppgave i testsettet.
 * Referansene lages med eval/anastruct/reference.py. Oppgaver uten reference.json hoppes over.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evalPoly, solve } from "../src/core/solver/index.js";
import { loadTestset } from "../eval/testset.js";

interface Reference {
  reactions: Record<string, { Fx: number; Fy: number; M: number }>;
  members: Record<string, { kind: "beam" | "truss"; N: number | null; M_ends_abs?: [number, number] }>;
}

const { cases } = await loadTestset("testset", { inputs: false });
const withReference = cases.filter((c) => existsSync(join(c.dir, "reference.json")));

describe("løseren mot anaStruct", () => {
  it("har referanser å sammenligne med", () => {
    expect(withReference.length).toBeGreaterThan(0);
  });

  it.each(withReference.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const ref = JSON.parse(readFileSync(join(c.dir, "reference.json"), "utf8")) as Reference;
    const result = solve(c.truth);
    if (result.status !== "ok") throw new Error(`${c.id}: ${result.status}`);

    const values = [
      ...Object.values(ref.reactions).flatMap((r) => [r.Fx, r.Fy, r.M]),
      ...Object.values(ref.members).flatMap((m) => [m.N ?? 0, ...(m.M_ends_abs ?? [])]),
    ];
    const tol = 1e-6 * Math.max(1, ...values.map(Math.abs));
    const near = (label: string, actual: number, expected: number) =>
      expect(Math.abs(actual - expected), `${label}: løser ${actual}, anaStruct ${expected}`).toBeLessThanOrEqual(tol);

    for (const r of result.reactions) {
      const e = ref.reactions[r.node]!;
      near(`${r.node}.Fx`, r.Fx, e.Fx);
      near(`${r.node}.Fy`, r.Fy, e.Fy);
      near(`${r.node}.M`, r.M, e.M);
    }
    for (const m of result.members) {
      const e = ref.members[m.id]!;
      const first = m.pieces[0]!;
      const last = m.pieces[m.pieces.length - 1]!;
      if (m.kind === "truss") near(`N_${m.id}`, evalPoly(first.N, m.length / 2), e.N!);
      else {
        near(`|M| ${m.id} i i-enden`, Math.abs(evalPoly(first.M, 0)), e.M_ends_abs![0]);
        near(`|M| ${m.id} i j-enden`, Math.abs(evalPoly(last.M, m.length)), e.M_ends_abs![1]);
      }
    }
  });
});
