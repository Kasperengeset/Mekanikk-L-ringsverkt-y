/** PLASSHOLDER – eies av spor C (opplasting og tolkning). */
import { FIXTURES } from "../fixtures";
import { useStore } from "../state/store";

export function UploadPanel() {
  const loadModel = useStore((s) => s.loadModel);
  return (
    <div className="upload">
      <h2>Last opp en oppgave</h2>
      <p>Opplasting av bilde, PDF eller tekst kommer her. Inntil videre kan du velge et eksempel:</p>
      <ul>
        {Object.entries(FIXTURES).map(([key, f]) => (
          <li key={key}>
            <button onClick={() => loadModel(f.model)}>{f.title}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
