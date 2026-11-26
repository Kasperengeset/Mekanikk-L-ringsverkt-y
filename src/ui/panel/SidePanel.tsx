/** Sidepanel i utforskingsfasen: status fra løseren, opplagerkrefter og angre/gjør om. Agenten kommer i uke 4. */
import type { Model } from "../../core/schema";
import type { SolveResult } from "../../core/solver";
import { formatQuantity } from "../format";
import { useStore } from "../state/store";

export function SidePanel({ model, result }: { model: Model; result: SolveResult }) {
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const reset = useStore((s) => s.reset);
  return (
    <div className="side-panel">
      <div className="toolbar">
        <button onClick={undo} disabled={!canUndo} title="Angre (Ctrl+Z)">
          Angre
        </button>
        <button onClick={redo} disabled={!canRedo} title="Gjør om (Ctrl+Shift+Z)">
          Gjør om
        </button>
        <button onClick={reset} title="Last opp en ny oppgave">
          Ny oppgave
        </button>
      </div>
      {result.status === "ok" ? (
        <>
          <h3>Opplagerkrefter</h3>
          <table className="reactions">
            <tbody>
              {result.reactions.map((r) => (
                <tr key={r.node}>
                  <th>{r.node}</th>
                  <td>H = {formatQuantity("force", r.Fx, model)}</td>
                  <td>V = {formatQuantity("force", r.Fy, model)}</td>
                  {r.M !== 0 && <td>M = {formatQuantity("moment", r.M, model)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            Statisk {result.determinacy.classification === "determinate" ? "bestemt" : `ubestemt (n = ${result.determinacy.n_s})`}.
          </p>
        </>
      ) : (
        <p className="warning">
          {result.status === "mechanism"
            ? result.message
            : result.status === "invalid"
              ? result.issues.map((i) => i.message).join(" ")
              : "Likevektskontrollen feilet, så resultatene vises ikke."}
        </p>
      )}
    </div>
  );
}
