/** Sidepanelet i utforskingsfasen: angre og gjør om, veilederen øverst, så opplagerkreftene og «Prøv selv». */
import { hiddenValues } from "../../core/pedagogy.js";
import type { Model } from "../../core/schema.js";
import type { SolveResult } from "../../core/solver/index.js";
import { AgentPanel } from "../agent/AgentPanel.js";
import { formatQuantity } from "../format.js";
import { CheckCircleIcon, InfoIcon, LockIcon, PlusIcon, RedoIcon, UndoIcon, WarningIcon } from "../icons.js";
import { PedagogyPanel } from "../pedagogy/PedagogyPanel.js";
import { useStore } from "../state/store.js";
import "./panel.css";

export function SidePanel({ model, result }: { model: Model; result: SolveResult }) {
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const reset = useStore((s) => s.reset);
  const attempts = useStore((s) => s.attempts);
  const hidden = hiddenValues(model, attempts);
  return (
    <>
      <div className="toolbar">
        <button type="button" onClick={undo} disabled={!canUndo} title="Angre (Ctrl+Z)">
          <UndoIcon />
          Angre
        </button>
        <button type="button" onClick={redo} disabled={!canRedo} title="Gjør om (Ctrl+Shift+Z)">
          <RedoIcon />
          Gjør om
        </button>
        <button type="button" className="primary push" onClick={reset} title="Last opp en ny oppgave">
          <PlusIcon />
          Ny oppgave
        </button>
      </div>
      <AgentPanel model={model} result={result} />
      <section className="card" aria-labelledby="reactions-title">
        <h2 id="reactions-title" className="card-title">
          Opplagerkrefter
        </h2>
        {result.status === "ok" ? (
          <>
            <ul className="reactions">
              {result.reactions.map((r) => (
                <li key={r.node} className={hidden.reactionNodes.has(r.node) ? "hidden-value" : undefined}>
                  <span className="node-badge">{r.node}</span>
                  {hidden.reactionNodes.has(r.node) ? (
                    <>
                      <span className="reaction-text muted">Skjult til du har prøvd selv</span>
                      <span className="reaction-lock">
                        <LockIcon />
                      </span>
                    </>
                  ) : (
                    <span className="reaction-text">
                      <span>H = {formatQuantity("force", r.Fx, model)}</span>
                      <span>V = {formatQuantity("force", r.Fy, model)}</span>
                      {r.M !== 0 && <span>M = {formatQuantity("moment", r.M, model)}</span>}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {result.determinacy.classification === "determinate" ? (
              <p className="status-pill determinacy">
                <CheckCircleIcon />
                Statisk bestemt
              </p>
            ) : (
              <p className="status-pill neutral determinacy">
                <InfoIcon />
                Statisk ubestemt (n = {result.determinacy.n_s})
              </p>
            )}
          </>
        ) : (
          <div className="alert" role="status">
            <WarningIcon />
            <span>
              {result.status === "mechanism"
                ? result.message
                : result.status === "invalid"
                  ? result.issues.map((i) => i.message).join(" ")
                  : "Likevektskontrollen feilet, så resultatene vises ikke."}
            </span>
          </div>
        )}
      </section>
      <PedagogyPanel model={model} result={result} />
    </>
  );
}
