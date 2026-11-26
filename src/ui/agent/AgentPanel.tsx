/** PLASSHOLDER – eies av spor D (agenten). Samtale med veilederen, strømmet fra /api/agent. */
import type { Model } from "../../core/schema";
import type { SolveResult } from "../../core/solver";

export function AgentPanel(props: { model: Model; result: SolveResult }) {
  void props;
  return (
    <section className="agent-panel">
      <h3>Veileder</h3>
      <p className="muted">Samtalen med veilederen kommer her.</p>
    </section>
  );
}
