/**
 * Å legge og flytte et snitt i konstruksjonsvisningen (rene funksjoner, testes uten nettleser).
 *
 * Et klikk på et element legger snittet der; dras pekeren, følger snittet langs den rette bjelken
 * (også forbi noder, som når en last dras). Posisjonen snappes til samme steg som lastene, men et snitt
 * står aldri nøyaktig i en node: der er snittkreftene ikke entydige, så det flyttes et halvt steg inn
 * på den siden pekeren er.
 */
import { collinearChain, type Chain } from "../../core/edit-ops.js";
import type { Model } from "../../core/schema.js";
import type { Point } from "../geometry.js";
import type { CutState } from "../state/store.js";
import { snapTo } from "./drag.js";
import { dot, length, nodePoint, sub, unit } from "./layout.js";

/** Den rette bjelken snittet kan flyttes langs. En stav er sin egen kjede. */
export function cutChain(model: Model, memberId: string): Chain | undefined {
  const m = model.members.find((x) => x.id === memberId);
  if (!m) return undefined;
  if (m.kind === "beam") return collinearChain(model, memberId);
  const a = nodePoint(model, m.i);
  const b = nodePoint(model, m.j);
  if (!a || !b) return undefined;
  const L = length(sub(b, a));
  if (!(L > 0)) return undefined;
  return {
    origin: a,
    dir: unit(sub(b, a)),
    length: L,
    segments: [{ member: m.id, s0: 0, s1: L, reversed: false }],
    stops: [
      { node: m.i, s: 0 },
      { node: m.j, s: L },
    ],
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Snittet for pekeren `world` (modellkoordinater) langs kjeden, snappet til `step`. */
export function cutOnChain(chain: Chain, world: Point, step: number): CutState | undefined {
  const raw = clamp(dot(sub(world, chain.origin), chain.dir), 0, chain.length);
  const half = Math.min(step / 2, chain.length / 4);
  const eps = 1e-9 * Math.max(chain.length, 1);
  let pos = snapTo(raw, step);
  const stop = chain.stops.find((st) => Math.abs(pos - st.s) < eps);
  if (stop) pos = stop.s + (raw >= stop.s ? half : -half);
  pos = clamp(pos, half, chain.length - half);
  const seg = chain.segments.find((sg) => pos > sg.s0 + eps && pos < sg.s1 - eps) ?? chain.segments.find((sg) => pos >= sg.s0 && pos <= sg.s1);
  if (!seg) return undefined;
  const local = (pos - seg.s0) / (seg.s1 - seg.s0);
  const at = Number((seg.reversed ? 1 - local : local).toFixed(12));
  const point = { x: Number((chain.origin.x + chain.dir.x * pos).toFixed(10)), y: Number((chain.origin.y + chain.dir.y * pos).toFixed(10)) };
  return { member: seg.member, at, point };
}
