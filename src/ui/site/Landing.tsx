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
    title: "Koble til Claude",
    text: "Legg til Mekanikk-intuisjon som connector i Claude og logg inn. Det tar et minutt, og du gjør det én gang.",
  },
  {
    title: "Spør om oppgaven",
    text: "Last opp et bilde eller en PDF fra øvingen i Claude. Claude leser figuren og sender konstruksjonen til våre verktøy.",
  },
  {
    title: "Utforsk",
    text: "Tallene kommer fra løseren vår, ikke fra språkmodellen. Åpne konstruksjonen her, dra i lastene og snitt hvor du vil.",
  },
];

const FEATURES = [
  {
    title: "Regnet ut, ikke gjettet",
    text: "Claude tolker oppgaven. Reaksjoner, snittkrefter og resultanter regnes av en verifisert løser, med likevektskontroll på hvert svar.",
  },
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
    title: "Samme språk hver gang",
    text: "Faste farger, symboler og fortegn som i kurset, uansett oppgave. Ikke en ny tegning hver gang du spør.",
  },
  {
    title: "Bjelker, rammer, fagverk og krefter",
    text: "Plan statikk på nivå med et første mekanikkfag: dekomponering og resultant, opplagre, ledd og fordelte laster.",
  },
];

const FAQ = [
  {
    q: "Hva trenger jeg?",
    a: "En Claude-konto og en gratis bruker her. Du legger til Mekanikk-intuisjon som egen connector i Claude under Connectors.",
  },
  {
    q: "Gir den meg svaret på øvingen?",
    a: "Tallene i appen er skjult til du har prøvd selv. I Claude bestemmer du hvor mye hjelp du vil ha, men tallene som kommer fra oss, er alltid kontrollert.",
  },
  {
    q: "Hva koster det?",
    a: "Eksemplene er gratis uten bruker. Med bruker får du et antall oppgaver gratis hver uke. Et rimelig studentabonnement kommer for dem som vil ha mer.",
  },
  {
    q: "Hva skjer med oppgavene mine?",
    a: "Claude sender bare konstruksjonen (mål, opplagre og laster) til oss, og vi lagrer den ikke. Se personvern for detaljene.",
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
              Bruk Claude på øvingen, med tall du kan stole på. Mekanikk-intuisjon regner ut reaksjoner og diagrammer med en verifisert løser, og lar deg
              dra i lastene og snitte hvor du vil, i 3D.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="/app?eksempel=gerber" onClick={linkClick("/app?eksempel=gerber")}>
                Prøv et eksempel
              </a>
              {signedIn ? (
                <a className="btn" href="/konto" onClick={linkClick("/konto")}>
                  Koble til Claude
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
            <p className="muted">Opprett bruker, legg til connectoren i Claude, og spør om den første oppgaven.</p>
          </div>
          <a className="btn btn-accent" href={signedIn ? "/konto" : "/logg-inn"} onClick={linkClick(signedIn ? "/konto" : "/logg-inn")}>
            {signedIn ? "Koble til Claude" : "Opprett gratis bruker"}
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
