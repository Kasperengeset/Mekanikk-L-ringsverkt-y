/**
 * Pedagogikk i sidepanelet (spor E):
 *  - Spådomskortet når agenten har spurt (store.prediction).
 *  - «Prøv selv»: ett felt per komponent i hvert mål (askedTargets). «Sjekk svaret» lagrer forsøket
 *    (store.recordAttempt) og gir tilbakemelding per komponent (checkAttempt). Etter et forsøk vises
 *    riktig verdi, og tallene i diagrammene og sidepanelet blir synlige (hiddenValues).
 *  - Glidebryterne i store.controls.
 *
 * Det studenten har skrevet, beholdes mens modellen endres (dra, angre), og nullstilles når
 * oppgaven spør om noe annet.
 */
import { useId, useState, type FormEvent } from "react";
import { anythingHidden, askedTargets, checkAttempt, hiddenValues, type AskedTarget, type Attempt } from "../../core/pedagogy.js";
import type { Model } from "../../core/schema.js";
import type { SolveResult } from "../../core/solver/index.js";
import { symbolicUnits } from "../format.js";
import { useStore } from "../state/store.js";
import { Controls } from "./Controls.js";
import { CONVENTION_TEXT, expectedText, HIDDEN_EXPLANATION, parseNumberInput, summaryText, unitLabel, VERDICT_TEXT } from "./logic.js";
import { PredictionCard } from "./PredictionCard.js";
import "./pedagogy.css";

type Drafts = Record<number, string[]>;

export function PedagogyPanel({ model, result }: { model: Model; result: SolveResult }) {
  const attempts = useStore((s) => s.attempts);
  const controls = useStore((s) => s.controls);
  const prediction = useStore((s) => s.prediction);
  const askedKey = JSON.stringify(model.asked);
  const [draftState, setDraftState] = useState<{ key: string; drafts: Drafts }>({ key: askedKey, drafts: {} });
  const drafts = draftState.key === askedKey ? draftState.drafts : {};
  const setDraft = (index: number, values: string[]) =>
    setDraftState((s) => ({ key: askedKey, drafts: { ...(s.key === askedKey ? s.drafts : {}), [index]: values } }));

  const hasAsked = model.asked.length > 0;
  if (!hasAsked && controls.length === 0 && !prediction) return null;

  const targets = askedTargets(model, result);
  const hidden = hiddenValues(model, attempts);
  const numeric = targets.some((t) => t.components.length > 0);

  return (
    <section className="pedagogy-panel">
      <PredictionCard />
      {hasAsked && (
        <>
          <h3>Prøv selv</h3>
          {anythingHidden(hidden) && <p className="pd-hidden-note">{HIDDEN_EXPLANATION}</p>}
          {result.status !== "ok" ? (
            <p className="muted">Svarene kan ikke sjekkes før konstruksjonen har en løsning.</p>
          ) : (
            <>
              {numeric && <p className="pd-convention muted">{CONVENTION_TEXT}</p>}
              {numeric && symbolicUnits(model) && <p className="pd-convention muted">Skriv tallet foran symbolene: 0,45 betyr 0,45 F. Brøk som 1/8 går også.</p>}
              {targets.map((t) => (
                <TargetCard key={t.index} target={t} model={model} attempt={attempts[t.index]} draft={drafts[t.index]} onDraft={(v) => setDraft(t.index, v)} />
              ))}
            </>
          )}
        </>
      )}
      <Controls model={model} />
    </section>
  );
}

interface TargetProps {
  target: AskedTarget;
  model: Model;
  attempt: Attempt | undefined;
  draft: string[] | undefined;
  onDraft(values: string[]): void;
}

function TargetCard(props: TargetProps) {
  const { target } = props;
  if (target.asked.quantity === "diagrams") return <DiagramsTarget target={target} attempt={props.attempt} />;
  if (target.components.length === 0)
    return (
      <div className="pd-target">
        <h4>{target.title}</h4>
        <p className="muted">Dette kan ikke sjekkes her, fordi punktet oppgaven spør om, ikke finnes i modellen.</p>
      </div>
    );
  return <NumericTarget {...props} />;
}

function DiagramsTarget({ target, attempt }: { target: AskedTarget; attempt: Attempt | undefined }) {
  const recordAttempt = useStore((s) => s.recordAttempt);
  return (
    <div className="pd-target">
      <h4>{target.title}</h4>
      {attempt ? (
        <p className="pd-feedback" role="status">
          Tallene vises nå i diagrammene. Sammenlign med det du tegnet.
        </p>
      ) : (
        <>
          <p className="muted">Tegn diagrammene selv først. Formen ser du allerede; tallene vises når du har tegnet.</p>
          <button type="button" className="pd-primary" onClick={() => recordAttempt(target.index, { values: null, at: Date.now() })}>
            Jeg har tegnet diagrammene selv – vis tallene
          </button>
        </>
      )}
    </div>
  );
}

function NumericTarget({ target, model, attempt, draft, onDraft }: TargetProps) {
  const recordAttempt = useStore((s) => s.recordAttempt);
  const baseId = useId();
  const [error, setError] = useState<string | null>(null);
  const texts = target.components.map((_, k) => draft?.[k] ?? "");
  const parsed = texts.map(parseNumberInput);
  const check = attempt ? checkAttempt(target, attempt) : undefined;
  const scale = Math.max(...target.components.map((c) => Math.abs(c.expected)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (parsed.some((v) => v !== null && Number.isNaN(v))) return setError("Ett av feltene er ikke et tall. Bruk desimalkomma, f.eks. 12,5.");
    if (parsed.every((v) => v === null)) return setError("Skriv inn minst ett tall før du sjekker.");
    setError(null);
    recordAttempt(target.index, { values: parsed, at: Date.now() });
  };

  return (
    <form className="pd-target" onSubmit={submit} noValidate>
      <h4>{target.title}</h4>
      {target.components.map((c, k) => {
        const id = `${baseId}-${k}`;
        const invalid = parsed[k] !== null && Number.isNaN(parsed[k]);
        // Et forsøk uten tall (values: null) er en egenvurdering: da vises bare fasit.
        const verdict = check && attempt?.values ? check.verdicts[k] : undefined;
        return (
          <div className="pd-component" key={k}>
            <label htmlFor={id}>
              {c.label}
              {c.magnitudeOnly && <span className="muted"> (størrelse)</span>}
            </label>
            <div className="pd-input">
              <input
                id={id}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={texts[k]}
                aria-invalid={invalid || undefined}
                onChange={(e) => onDraft(texts.map((t, j) => (j === k ? e.target.value : t)))}
              />
              <span className="pd-unit">{unitLabel(c.unit, model)}</span>
            </div>
            {attempt && (
              <p className={`pd-verdict${verdict ? ` pd-${verdict}` : ""}`}>
                {verdict && <strong>{VERDICT_TEXT[verdict]}. </strong>}
                Riktig verdi: {expectedText(c, model, scale)}
              </p>
            )}
          </div>
        );
      })}
      {error && <p className="pd-error">{error}</p>}
      <div className="pd-actions">
        <button type="submit" className="pd-primary">
          Sjekk svaret
        </button>
        {check && attempt?.values && (
          <span className={`pd-summary${check.allCorrect ? " pd-correct" : ""}`} role="status">
            {summaryText(check)}
          </span>
        )}
      </div>
    </form>
  );
}
