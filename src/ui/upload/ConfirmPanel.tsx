/**
 * Bekreftelsessteget (fasen confirm): Claudes spørsmål og de usikre entitetene (provenance med
 * confidence < 0,7), som også utheves i konstruksjonsvisningen. Alternativene er knapper som endrer
 * modellen med store.edit, så studenten retter en feiltolkning med ett klikk.
 */
import { useEffect, useMemo, useState } from "react";
import { getParam } from "../../core/edit.js";
import type { Model } from "../../core/schema.js";
import { formatNumber } from "../format.js";
import { useStore } from "../state/store.js";
import { useSolveResult } from "../state/useSolveResult.js";
import { entryTitle, formatValue, highlightRefs, parseAlternative, uncertainEntries, type UncertainEntry } from "./provenance.js";
import { resetToUpload, useUploadSession } from "./session.js";
import "./upload.css";

interface Choice {
  key: string;
  label: string;
  value?: unknown;
  error?: string;
  original?: boolean;
}

/** Knappene for en oppføring: verdien Claude valgte, og alternativene. Like verdier vises én gang. */
function choicesFor(entry: UncertainEntry, model: Model, original: unknown): Choice[] {
  const path = entry.path!;
  const out: Choice[] = [];
  const seen = new Set<string>();
  const add = (c: Choice) => {
    const key = c.error ? `feil:${c.label}` : JSON.stringify(c.value);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...c, key });
  };
  if (original !== undefined) add({ key: "", label: formatValue(path, original, model), value: original, original: true });
  for (const alt of entry.provenance.alternatives ?? []) {
    const parsed = parseAlternative(alt, path, model);
    if (parsed.ok) add({ key: "", label: formatValue(path, parsed.value, model), value: parsed.value });
    else add({ key: "", label: alt, error: parsed.error });
  }
  return out;
}

export function ConfirmPanel() {
  const model = useStore((s) => s.model);
  const interpretation = useStore((s) => s.interpretation);
  const setPhase = useStore((s) => s.setPhase);
  const setHighlights = useStore((s) => s.setHighlights);
  const edit = useStore((s) => s.edit);
  const meta = useUploadSession((s) => s.meta);
  const result = useSolveResult();

  const entries = useMemo(() => (model ? uncertainEntries(model) : []), [model]);
  const refs = useMemo(() => highlightRefs(entries), [entries]);
  const refsKey = refs.map((r) => `${r.kind}:${r.id}`).join(",");
  // refs endrer identitet ved hver endring av modellen; innholdet (refsKey) er det som teller.
  useEffect(() => {
    setHighlights(refs);
  }, [refsKey, setHighlights]);

  // Verdiene slik Claude tolket dem, så studenten kan bytte tilbake etter å ha prøvd et alternativ.
  const [original] = useState(() => new Map(entries.flatMap((e) => (e.path && model ? [[e.path, getParam(model, e.path)] as const] : []))));
  const [errors, setErrors] = useState<Record<number, string>>({});

  if (!model) return null;

  const choose = (entry: UncertainEntry, choice: Choice) => {
    if (choice.error) return setErrors((e) => ({ ...e, [entry.index]: choice.error! }));
    const r = edit({ path: entry.path!, value: choice.value });
    setErrors((e) => {
      const next = { ...e };
      if (r.ok) delete next[entry.index];
      else next[entry.index] = `Endringen ble avvist: ${r.error}`;
      return next;
    });
  };

  const confirm = () => {
    setHighlights([]);
    setPhase("explore");
  };

  const questions = interpretation.questions;
  return (
    <div className="confirm">
      <h2>Stemmer modellen med oppgaven?</h2>
      <p className="muted">Sammenlign tegningen med oppgaven. Det som er markert, var Claude usikker på.</p>

      {result && result.status !== "ok" && (
        <p className="warning">
          {result.status === "mechanism"
            ? `Modellen er en mekanisme: ${result.message}`
            : result.status === "invalid"
              ? result.issues.map((i) => i.message).join(" ")
              : "Likevektskontrollen feilet for denne modellen."}
        </p>
      )}

      {questions.length > 0 && (
        <>
          <h3>Spørsmål fra Claude</h3>
          <ul className="questions">
            {questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </>
      )}

      {entries.length > 0 ? (
        <>
          <h3>Usikre deler ({entries.length})</h3>
          <ul className="uncertain-list">
            {entries.map((entry) => {
              const p = entry.provenance;
              const current = entry.path ? getParam(model, entry.path) : undefined;
              const choices = entry.path ? choicesFor(entry, model, original.get(entry.path)) : [];
              return (
                <li key={entry.index} className="uncertain">
                  <div className="uncertain-head">
                    <strong>{entryTitle(p)}</strong>
                    <span className="muted">{formatNumber(p.confidence * 100, 2)} % sikker</span>
                  </div>
                  <p>{p.note}</p>
                  {entry.path && current !== undefined && (
                    <p className="muted">Nå: {formatValue(entry.path, current, model)}</p>
                  )}
                  {choices.length > 1 && (
                    <div className="choices" role="group" aria-label={`Velg verdi for ${entryTitle(p)}`}>
                      {choices.map((c) => {
                        const active = !c.error && JSON.stringify(c.value) === JSON.stringify(current);
                        return (
                          <button
                            key={c.key}
                            aria-pressed={active}
                            onClick={() => !active && choose(entry, c)}
                            title={c.original ? "Claudes tolkning" : undefined}
                          >
                            {c.label}
                            {c.original ? " (tolket)" : ""}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {!entry.path && p.alternatives && p.alternatives.length > 0 && (
                    <p className="muted">Andre muligheter: {p.alternatives.join(", ")}</p>
                  )}
                  {errors[entry.index] && <p className="warning">{errors[entry.index]}</p>}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p>Claude markerte ingenting som usikkert. Sjekk likevel at opplagre, laster og mål stemmer.</p>
      )}

      {meta && meta.warnings.length > 0 && (
        <>
          <h3>Merknader</h3>
          <ul>
            {meta.warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </>
      )}

      {interpretation.description && (
        <details>
          <summary>Claudes beskrivelse av oppgaven</summary>
          <p>{interpretation.description}</p>
        </details>
      )}

      <div className="toolbar">
        <button className="primary" onClick={confirm}>
          Ser riktig ut
        </button>
        <button onClick={resetToUpload}>Last opp på nytt</button>
      </div>

      {meta?.consistency && (
        <p className="muted meta">
          Oppgaven ble tolket {meta.consistency.succeeded} ganger og sammenlignet
          {meta.consistency.disagreements.length ? `; ${meta.consistency.disagreements.length} uenighet(er) er markert over.` : "."}
        </p>
      )}
      {import.meta.env.DEV && meta && (
        <p className="muted meta">
          Utvikling: {meta.costUsd !== null ? `${formatNumber(meta.costUsd, 3)} USD · ` : ""}
          {meta.usage.inputTokens + meta.usage.cacheReadTokens + meta.usage.cacheWriteTokens} token inn, {meta.usage.outputTokens} ut
        </p>
      )}
    </div>
  );
}
