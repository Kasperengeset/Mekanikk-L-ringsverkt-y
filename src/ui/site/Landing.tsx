/**
 * Forsiden: hva verktøyet gjør, hvordan det virker, og veien inn (prøv et eksempel uten bruker, eller
 * opprett bruker for egne oppgaver). Figuren øverst er den ekte tegningen av et eksempel, ikke et bilde.
 */
import { useMemo } from "react";
import { solve } from "../../core/solver/index.js";
import { useAuth } from "../auth/auth.js";
import { DiagramCards } from "../diagrams/DiagramCards.js";
import { FIXTURES } from "../fixtures.js";
import { fitViewport } from "../geometry.js";
import { linkClick } from "../router.js";
import { StructureSvg } from "../structure/StructureSvg.js";
import { useElementSize } from "../useElementSize.js";
import "../diagrams/diagrams.css";
import "../structure/structure.css";
import { SiteFooter, SiteHeader } from "./SiteHeader.js";

const STEPS = [
  {
    title: "Last opp oppgaven",
    text: "Et bilde, en PDF fra øvingen eller teksten. Claude leser figuren og lager en modell: noder, opplagre og laster.",
  },
  {
    title: "Sjekk tolkningen",
    text: "Du ser modellen tegnet før noe regnes ut. Er noe usikkert, spør appen deg, og du retter med ett klikk.",
  },
  {
    title: "Utforsk",
    text: "Dra i lastene, bytt opplagre og snitt hvor du vil. Diagrammene og kreftene følger med med en gang.",
  },
];

const FEATURES = [
  {
    title: "Diagrammer som følger med",
    text: "N-, V- og M-diagrammet og den deformerte formen tegnes rett under konstruksjonen og endrer seg mens du drar.",
  },
  {
    title: "Snitt i 3D",
    text: "Klikk hvor som helst på en bjelke og se de to frie legemene med snittkreftene, og spenningene σ og τ i tverrsnittet.",
  },
  {
    title: "Prøv selv først",
    text: "Tallene du skal finne, er skjult til du har prøvd. Formen ser du, så du kan resonnere deg fram.",
  },
  {
    title: "En veileder som ikke jukser",
    text: "Spør om det du ser. Veilederen forklarer og stiller spørsmål tilbake, men gir deg ikke svaret på øvingen.",
  },
  {
    title: "Regnet ut, ikke gjettet",
    text: "Claude tolker bare figuren. Alt som vises, regnes ut av en egen løser i nettleseren og kontrolleres med likevekt.",
  },
  {
    title: "Bjelker, rammer og fagverk",
    text: "Plan statikk på nivå med et første mekanikkfag: fast innspenning, fastlager, rullelager, ledd og fordelte laster.",
  },
];

const FAQ = [
  {
    q: "Gir den meg svaret på øvingen?",
    a: "Nei, ikke før du har prøvd. Tallene du blir spurt om, er skjult til du har skrevet inn et svar, og veilederen er laget for å hjelpe deg å tenke, ikke for å regne for deg.",
  },
  {
    q: "Hvilke oppgaver kan den?",
    a: "Statisk bestemte og lavt ubestemte bjelker, plane rammer og fagverk med punktlaster, momenter og fordelte laster. Ikke 3D-konstruksjoner, dynamikk eller knekning.",
  },
  {
    q: "Hva koster det?",
    a: "Eksemplene er gratis uten bruker. Med bruker får du en gratis kvote med tolkninger og spørsmål til veilederen hver uke. Et rimelig studentabonnement kommer for dem som vil ha mer.",
  },
  {
    q: "Hva skjer med oppgavene jeg laster opp?",
    a: "Bildet eller teksten sendes til Claude (Anthropic) for tolkning. Vi lagrer ikke oppgavene. Se personvern for detaljene.",
  },
];

/** Gerberbjelken med M-diagrammet, tegnet med de samme komponentene som verktøyet. */
function HeroFigure() {
  const model = FIXTURES.gerber!.model;
  const result = useMemo(() => solve(model), [model]);
  const [ref, size] = useElementSize<HTMLDivElement>();
  const width = size.width;
  const viewport = width > 0 ? fitViewport(model, width, Math.max(150, Math.min(200, width * 0.3)), { padding: Math.min(56, width * 0.09) }) : null;
  return (
    <div className="hero-figure" ref={ref} aria-label="Eksempel: gerberbjelke med momentdiagram" role="img">
      {viewport && (
        <>
          <StructureSvg model={model} result={result} viewport={viewport} />
          <div className="hero-diagram">
            <DiagramCards model={model} result={result} viewport={viewport} settings={{ N: false, V: false, M: true, deformed: false, deformationScale: "auto" }} />
          </div>
        </>
      )}
    </div>
  );
}

export function Landing() {
  const status = useAuth((s) => s.status);
  const signedIn = status === "signedIn";
  return (
    <div className="site">
      <SiteHeader />
      <main>
        <section className="hero">
          <div className="hero-text">
            <p className="kicker">Statikk for byggstudenter</p>
            <h1>Se hva som skjer inni konstruksjonen</h1>
            <p className="lede">
              Last opp en oppgave fra øvingen. Appen tegner konstruksjonen, regner ut diagrammene og lar deg dra i lastene og se alt endre seg. Snitt hvor du
              vil og se kreftene i 3D.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="/app?eksempel=gerber" onClick={linkClick("/app?eksempel=gerber")}>
                Prøv et eksempel
              </a>
              {signedIn ? (
                <a className="btn" href="/app" onClick={linkClick("/app")}>
                  Last opp en oppgave
                </a>
              ) : (
                <a className="btn" href="/logg-inn" onClick={linkClick("/logg-inn")}>
                  Opprett gratis bruker
                </a>
              )}
            </div>
            <p className="hero-note muted">Eksemplene virker uten bruker. Ingen passord.</p>
          </div>
          <div className="card hero-card">
            <HeroFigure />
          </div>
        </section>

        <section className="section" aria-labelledby="steps-title">
          <h2 id="steps-title" className="section-title">
            Slik virker det
          </h2>
          <ol className="steps">
            {STEPS.map((s, k) => (
              <li key={s.title} className="card step">
                <span className="step-number" aria-hidden="true">
                  {k + 1}
                </span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="section" aria-labelledby="features-title">
          <h2 id="features-title" className="section-title">
            Bygget for å forstå, ikke for å kopiere
          </h2>
          <ul className="features">
            {FEATURES.map((f) => (
              <li key={f.title} className="feature">
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="section cta-band">
          <div>
            <h2 className="section-title">Kom i gang på et minutt</h2>
            <p className="muted">Skriv inn e-posten din, klikk lenken du får, og last opp den første oppgaven.</p>
          </div>
          <a className="btn btn-accent" href={signedIn ? "/app" : "/logg-inn"} onClick={linkClick(signedIn ? "/app" : "/logg-inn")}>
            {signedIn ? "Åpne verktøyet" : "Opprett gratis bruker"}
          </a>
        </section>

        <section className="section" aria-labelledby="faq-title">
          <h2 id="faq-title" className="section-title">
            Spørsmål og svar
          </h2>
          <div className="faq">
            {FAQ.map((f) => (
              <details key={f.q} className="faq-item">
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
