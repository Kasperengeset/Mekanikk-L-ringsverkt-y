/** PLASSHOLDER – eies av spor C (bekreftelsessteget). */
import { useStore } from "../state/store";

export function ConfirmPanel() {
  const setPhase = useStore((s) => s.setPhase);
  return (
    <div className="confirm">
      <h2>Stemmer modellen med oppgaven?</h2>
      <button onClick={() => setPhase("explore")}>Ja, gå videre</button>
    </div>
  );
}
