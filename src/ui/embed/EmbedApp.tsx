/**
 * Visningen i Claude-chatten (MCP Apps): det verktøyene svarte, tegnet med de samme komponentene som
 * webappen. Konstruksjoner kan dras i og snittes her; løseren kjører i nettleseren, så diagrammene og
 * 3D-snittet følger med uten nye kall. Ren komponent: innholdet kommer som `payload` (structuredContent).
 */
import { useEffect } from "react";
import type { ForceSystemResult } from "../../core/forces.js";
import { Model } from "../../core/schema.js";
import { forceFactor, lengthFactor } from "../../core/units.js";
import { CutCard } from "../cut3d/CutCard.js";
import { DiagramsView } from "../diagrams/DiagramsView.js";
import { formatNumber } from "../format.js";
import { ForceSystemView } from "../forces/ForceSystemView.js";
import { fitViewport, structureHeight } from "../geometry.js";
import { useStore } from "../state/store.js";
import { useSolveResult } from "../state/useSolveResult.js";
import { StructureView } from "../structure/StructureView.js";
import { useElementSize } from "../useElementSize.js";
import "./embed.css";

/** Det verktøyene sender som structuredContent (se server/modules/mechanics/tools.ts). */
export type EmbedPayload =
  | { view: "structure"; model: unknown; open_url?: string }
  | ({ view: "forces"; units: { force: string; length: string } } & Pick<ForceSystemResult, "forces" | "resultant" | "moment" | "equilibrium">)
  | { view?: undefined; status?: string; message?: string };

export interface EmbedActions {
  openLink?(url: string): void;
  fullscreen?(): void;
}

export function EmbedApp({ payload, actions = {}, pending = false }: { payload: EmbedPayload | null; actions?: EmbedActions; pending?: boolean }) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  return (
    <div className="embed" ref={ref}>
      <header className="embed-head">
        <span className="embed-brand">
          Mekanikk-<span>intuisjon</span>
        </span>
        <span className="embed-actions">
          {actions.fullscreen && (
            <button type="button" className="pill sm" onClick={actions.fullscreen}>
              Fullskjerm
            </button>
          )}
          {payload?.view === "structure" && payload.open_url && actions.openLink && (
            <button type="button" className="pill sm" onClick={() => actions.openLink!(payload.open_url!)}>
              Åpne i appen
            </button>
          )}
        </span>
      </header>
      {!payload ? (
        <p className="embed-empty muted">{pending ? "Regner …" : "Venter på resultatet …"}</p>
      ) : payload.view === "forces" ? (
        <ForceSystemView result={payload} forceUnit={payload.units.force} lengthUnit={payload.units.length} width={size.width} />
      ) : payload.view === "structure" ? (
        <StructureEmbed model={payload.model} />
      ) : (
        <p className="embed-empty">{payload.message ?? "Ingen figur for dette svaret."}</p>
      )}
    </div>
  );
}

function StructureEmbed({ model: raw }: { model: unknown }) {
  const loadModel = useStore((s) => s.loadModel);
  const model = useStore((s) => s.model);
  const result = useSolveResult();
  const [figureRef, size] = useElementSize<HTMLDivElement>();

  useEffect(() => {
    // Tallene står allerede i Claudes svar, så ingenting skjules her (tutormodus kommer med stegmotoren).
    const parsed = Model.safeParse(raw);
    if (parsed.success) loadModel({ ...parsed.data, asked: [] }, "explore");
  }, [raw, loadModel]);

  if (!model || !result) return <p className="embed-empty muted">Ugyldig modell.</p>;
  const width = size.width;
  const viewport = width > 0 ? fitViewport(model, width, Math.min(structureHeight(model, width), 360), { padding: 60 }) : null;
  const f = model.units.force;
  const F = forceFactor(model.units);
  const L = lengthFactor(model.units);
  return (
    <div className="embed-structure">
      <section className="card figure-card" aria-label="Konstruksjonen">
        <div ref={figureRef}>{viewport && <StructureView model={model} result={result} viewport={viewport} />}</div>
        <p className="figure-hint muted">Dra i lastene, eller klikk på et element for å snitte det i 3D.</p>
      </section>
      {result.status === "ok" && (
        <ul className="embed-reactions" aria-label="Opplagerkrefter">
          {result.reactions.map((r) => (
            <li key={r.node}>
              <strong>{r.node}</strong>
              <span>H = {formatNumber(r.Fx / F)} {f}</span>
              <span>V = {formatNumber(r.Fy / F)} {f}</span>
              {model.supports.find((s) => s.node === r.node)?.type === "fixed" && (
                <span>
                  M = {formatNumber(r.M / (F * L))} {f}
                  {model.units.length}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <CutCard model={model} result={result} />
      {viewport && <DiagramsView model={model} result={result} viewport={viewport} />}
    </div>
  );
}
