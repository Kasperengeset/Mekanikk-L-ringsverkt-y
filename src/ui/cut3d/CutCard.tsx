/**
 * Kortet «Snitt i 3D» under konstruksjonen: 3D-figuren av snittet (lastes ved behov), tallene for N, V
 * og M i snittet, og spenningene i tverrsnittet. Vises når studenten har lagt et snitt (klikk på et
 * element i konstruksjonen).
 */
import { lazy, Suspense, useMemo, useState } from "react";
import { resolveCut } from "../../core/cut.js";
import { hiddenValues, isDiagramValueHidden } from "../../core/pedagogy.js";
import type { Model } from "../../core/schema.js";
import type { SolveResult } from "../../core/solver/index.js";
import { InfoIcon, LockIcon } from "../icons.js";
import { useStore, type CutMode } from "../state/store.js";
import { cutReadout } from "./readout.js";
import { buildCutScene } from "./scene.js";
import { StressPanel } from "./StressPanel.js";
import "./cut3d.css";

const Cut3DCanvas = lazy(() => import("./Cut3DCanvas.js"));

const MODES: { mode: CutMode; label: string; title: string }[] = [
  { mode: "forces", label: "Snittkrefter", title: "Vis N, V og M på snittflatene" },
  { mode: "stress", label: "Spenninger", title: "Vis normal- og skjærspenningene i tverrsnittet" },
];

export function CutCard({ model, result }: { model: Model; result: SolveResult }) {
  const stored = useStore((s) => s.cut);
  const mode = useStore((s) => s.cutMode);
  const setMode = useStore((s) => s.setCutMode);
  const setCut = useStore((s) => s.setCut);
  const attempts = useStore((s) => s.attempts);
  const [resets, setResets] = useState(0);
  const hidden = useMemo(() => hiddenValues(model, attempts), [model, attempts]);
  const cut = useMemo(() => (stored ? resolveCut(model, stored) : undefined), [model, stored]);
  const ok = result.status === "ok" ? result : undefined;
  const scene = useMemo(() => (ok && cut ? buildCutScene({ model, result: ok, cut, mode, hidden }) : undefined), [model, ok, cut, mode, hidden]);
  const readout = useMemo(() => (ok && cut ? cutReadout(model, ok, cut, hidden) : undefined), [model, ok, cut, hidden]);
  if (!cut) return null;

  const member = model.members.find((m) => m.id === cut.member);
  const section = model.sections.find((s) => s.id === member?.section);
  const masked = (q: "N" | "V" | "M") => isDiagramValueHidden(hidden, q, cut.member);
  const label = readout
    ? `3D-figur av snittet i ${readout.member}, ${readout.position}. ${readout.rows.map((r) => `${r.q} = ${r.value}${r.note ? `, ${r.note}` : ""}`).join(". ")}.`
    : "3D-figur av snittet";

  return (
    <section className="card c3-card" aria-labelledby="c3-title">
      <div className="card-head c3-head">
        <div>
          <h2 id="c3-title" className="card-title">
            Snitt i 3D
          </h2>
          {readout && (
            <p className="c3-where muted">
              Element {readout.member}, {readout.position}
            </p>
          )}
        </div>
        <button type="button" className="btn-link c3-remove" onClick={() => setCut(null)}>
          Fjern snittet
        </button>
      </div>

      {!ok || !scene || !readout ? (
        <div className="alert" role="status">
          <span>Snittkreftene vises når konstruksjonen har en løsning.</span>
        </div>
      ) : (
        <>
          <div className="c3-toolbar" role="toolbar" aria-label="3D-visning">
            {MODES.map((m) => (
              <button key={m.mode} type="button" className="pill" aria-pressed={mode === m.mode} title={m.title} onClick={() => setMode(m.mode)}>
                {m.label}
              </button>
            ))}
            <button type="button" className="pill sm c3-reset" onClick={() => setResets((n) => n + 1)}>
              Tilbakestill visning
            </button>
          </div>
          <div className="c3-stage">
            <Suspense fallback={<div className="c3-canvas c3-loading muted">Laster 3D-visningen …</div>}>
              <Cut3DCanvas scene={scene} viewKey={`${mode}:${resets}`} label={label} />
            </Suspense>
          </div>
          <p className="c3-hint muted">Dra for å rotere, knip eller Ctrl/⌘ + rull for å zoome, høyreklikk og dra for å flytte. Flytt snittet ved å dra det langs elementet i konstruksjonen.</p>

          <ul className="c3-readout" aria-label="Snittkrefter">
            {readout.rows.map((r) => (
              <li key={r.q} className={`c3-row c3-row-${r.q}`}>
                <span className={`c3-swatch c3-swatch-${r.q}`} aria-hidden="true" />
                <span className="c3-row-name">
                  <strong>{r.q}</strong> {r.name.toLowerCase()}
                </span>
                <span className="c3-row-value">
                  {r.value}
                  {r.note && <span className="muted"> ({r.note})</span>}
                </span>
                {r.masked && (
                  <span className="c3-lock" title="Skjult til du har prøvd selv">
                    <LockIcon />
                  </span>
                )}
              </li>
            ))}
          </ul>

          {mode === "stress" && (
            <StressPanel section={section} forces={readout.forces} truss={readout.truss} sigmaHidden={masked("N") || masked("M")} tauHidden={masked("V")} symbolic={model.symbols.length > 0} />
          )}

          <p className="c3-legend">
            {mode === "forces" ? (
              <>
                <span className="c3-key c3-key-loadPoint">Last</span>
                <span className="c3-key c3-key-reaction">Opplagerkraft</span>
                <span className="c3-key c3-key-N">N</span>
                {!readout.truss && <span className="c3-key c3-key-V">V</span>}
                {!readout.truss && <span className="c3-key c3-key-M">M</span>}
              </>
            ) : (
              <>
                <span className="c3-key c3-key-tension">Strekk</span>
                <span className="c3-key c3-key-compression">Trykk</span>
                {!readout.truss && <span className="c3-key c3-key-tau">τ</span>}
              </>
            )}
          </p>
          {!scene.separated && (
            <div className="callout">
              <InfoIcon />
              <span>Snittet deler ikke konstruksjonen i to, fordi den er lukket. Kreftene i snittflatene vises likevel, men et fritt legeme krever flere snitt.</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
