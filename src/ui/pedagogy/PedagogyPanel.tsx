/**
 * PLASSHOLDER – eies av spor E (pedagogikk i visningen): forsøk på det oppgaven spør om,
 * glidebrytere (store.controls) og spådomsspørsmål (store.prediction).
 */
import type { Model } from "../../core/schema";
import type { SolveResult } from "../../core/solver";

export function PedagogyPanel(props: { model: Model; result: SolveResult }) {
  void props;
  return (
    <section className="pedagogy-panel">
      <h3>Prøv selv</h3>
      <p className="muted">Her skal studenten svare på det oppgaven spør om før tallene vises.</p>
    </section>
  );
}
