/**
 * Verktøyet uten modell: eksemplene, og hvordan du bruker Mekanikk-intuisjon i Claude (connector).
 * Oppgaver tolkes av Claude hos studenten; Claude sender modellen hit med lenken «Åpne i moment.no».
 */
import { FIXTURES } from "../fixtures.js";
import { useStore } from "../state/store.js";
import "./start.css";

export function connectorUrl(): string {
  return typeof window === "undefined" ? "https://moment.no/mcp" : `${window.location.origin}/mcp`;
}

export function StartPanel() {
  const loadModel = useStore((s) => s.loadModel);
  const url = connectorUrl();
  return (
    <div className="card start">
      <h2 className="card-title">Bruk Mekanikk-intuisjon i Claude</h2>
      <p className="muted">
        Claude leser oppgaven din (bilde, PDF eller tekst) og bruker våre verktøy til å regne. Tallene kommer fra en verifisert løser, ikke fra
        språkmodellen. Fra svaret åpner du konstruksjonen her, med diagrammer og snitt i 3D.
      </p>
      <ol className="start-steps">
        <li>
          I Claude: <strong>Innstillinger → Connectors → Legg til egen connector</strong>.
        </li>
        <li>
          Lim inn adressen <code className="start-url">{url}</code> og logg inn med brukeren din her.
        </li>
        <li>Last opp oppgaven i Claude og be om hjelp. Trykk lenken i svaret for å åpne den her.</li>
      </ol>
      <section className="examples">
        <h3>Prøv et eksempel</h3>
        <div className="example-list">
          {Object.entries(FIXTURES).map(([key, f]) => (
            <button key={key} type="button" onClick={() => loadModel(f.model)}>
              {f.title}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
