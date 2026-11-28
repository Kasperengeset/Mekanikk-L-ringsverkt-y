/** Eksempler på verktøysvar for å se visningen lokalt (bare `pnpm dev`, se main.tsx). */
import { solveForceSystem } from "../../core/forces.js";
import { FIXTURES } from "../fixtures.js";
import { modelLink } from "../share.js";
import type { EmbedPayload } from "./EmbedApp.js";

export function demoPayload(name: string, origin: string): EmbedPayload {
  if (name === "forces") {
    const units = { length: "m", force: "N" } as const;
    const r = solveForceSystem({
      units,
      forces: [
        { id: "F1", magnitude: 600, angle_deg: 35 },
        { id: "F2", magnitude: 500, direction: { dx: -4, dz: 3 } },
        { id: "F3", magnitude: 800, direction: { dx: 0.2, dz: -0.4 } },
      ],
    });
    if (r.status !== "ok") return { message: "Demo feilet." };
    return { view: "forces", units, ...r };
  }
  const model = (FIXTURES[name] ?? FIXTURES.gerber!).model;
  return { view: "structure", model, open_url: modelLink(origin, model) };
}
