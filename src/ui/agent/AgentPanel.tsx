/**
 * Samtalen med veilederen: studentens meldinger, veilederens tekst strømmet fortløpende og korte linjer
 * for handlingene den gjør i verktøyet. Samtalen og løkken bor i conversation.ts.
 */
import { Fragment, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import type { Model } from "../../core/schema.js";
import type { SolveResult } from "../../core/solver/index.js";
import { SendIcon, StopIcon, WarningIcon } from "../icons.js";
import { useStore } from "../state/store.js";
import { useAgentStore, type ChatEntry } from "./conversation.js";
import { MAX_STUDENT_TEXT } from "./protocol.js";
import "./agent.css";
import { LoginPrompt, useNeedsLogin } from "../auth/LoginPrompt.js";

export const SUGGESTIONS = ["Forklar M-diagrammet", "Gi meg et hint", "Hva skjer hvis jeg flytter lasten?"];

/** Tekst med avsnitt og **uthevet** tekst; alt annet vises som det er. */
function RichText({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/);
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i}>
          {p.split(/(\*\*[^*\n]+\*\*)/).map((part, k): ReactNode =>
            part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={k}>{part.slice(2, -2)}</strong> : <Fragment key={k}>{part}</Fragment>,
          )}
        </p>
      ))}
    </>
  );
}

function Entry({ entry, onRetry }: { entry: ChatEntry; onRetry?: () => void }) {
  switch (entry.kind) {
    case "student":
      return <div className="agent-msg agent-student">{entry.text}</div>;
    case "tutor":
      return (
        <div className={`agent-msg agent-tutor${entry.streaming ? " streaming" : ""}`}>
          <RichText text={entry.text} />
          {entry.cut && <span className="agent-cut">{entry.cut === "aborted" ? "(avbrutt)" : "(kuttet)"}</span>}
        </div>
      );
    case "action":
      return <div className={`agent-action${entry.error ? " error" : ""}`}>{entry.text}</div>;
    case "notice":
      return entry.tone === "error" ? (
        <div className="alert agent-notice" role="alert">
          <WarningIcon />
          <span>{entry.text}</span>
          {onRetry && (
            <button type="button" className="btn-link" onClick={onRetry}>
              Prøv igjen
            </button>
          )}
        </div>
      ) : (
        <p className="agent-notice info">{entry.text}</p>
      );
  }
}

export function AgentPanel(props: { model: Model; result: SolveResult }) {
  // Veilederen leser modellen og løsningen fra storen når den kaller get_state, ikke fra props.
  void props;
  const entries = useAgentStore((s) => s.entries);
  const activity = useAgentStore((s) => s.activity);
  const costUsd = useAgentStore((s) => s.costUsd);
  const send = useAgentStore((s) => s.send);
  const abort = useAgentStore((s) => s.abort);
  const newConversation = useAgentStore((s) => s.newConversation);
  const retry = useAgentStore((s) => s.retry);
  // Siste melding fra studenten fikk ikke svar (feil eller avbrudd): den kan sendes på nytt.
  const unanswered = useAgentStore((s) => s.history.at(-1)?.role === "user");
  const waitingForPrediction = useStore((s) => s.prediction !== null);
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const busy = activity !== null;
  const needsLogin = useNeedsLogin();

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [entries, activity]);

  const submit = (text: string) => {
    if (busy || !text.trim()) return;
    setDraft("");
    void send(text);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(draft);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(draft);
    }
  };

  const status =
    busy && waitingForPrediction
      ? "Venter på spådommen din …"
      : activity === "thinking"
        ? "Veilederen tenker …"
        : activity === "acting"
          ? "Veilederen arbeider i verktøyet …"
          : null;

  if (needsLogin)
    return (
      <section className="card agent-panel" aria-label="Veileder">
        <h2 className="card-title">Veileder</h2>
        <LoginPrompt title="Logg inn for å spørre veilederen" text="Veilederen forklarer det du ser uten å gi deg svaret. Den krever bruker, siden hvert svar koster litt å lage." />
      </section>
    );

  return (
    <section className="card agent-panel" aria-label="Veileder">
      <div className="card-head">
        <h2 className="card-title">Veileder</h2>
        {entries.length > 0 && (
          <button type="button" className="agent-new" onClick={newConversation} title="Tøm samtalen og start på nytt">
            Ny samtale
          </button>
        )}
      </div>
      <div className="agent-log" ref={logRef} role="log" aria-live="polite" aria-busy={busy}>
        {entries.length === 0 ? (
          <p className="muted agent-intro">
            Spør om det du ser. Veilederen regner ikke selv: tallene kommer fra løseren, og tall du skal finne selv, holdes skjult til du har
            prøvd.
          </p>
        ) : (
          entries.map((e, k) => (
            <Entry key={e.id} entry={e} onRetry={k === entries.length - 1 && unanswered && !busy ? () => void retry() : undefined} />
          ))
        )}
        {status && <p className="agent-status">{status}</p>}
      </div>
      {entries.length === 0 && (
        <div className="agent-suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="pill sm agent-chip" onClick={() => submit(s)} disabled={busy}>
              {s}
            </button>
          ))}
        </div>
      )}
      <form className="agent-composer" onSubmit={onSubmit}>
        <textarea
          id="agent-input"
          aria-label="Melding til veilederen"
          placeholder="Spør veilederen …"
          rows={2}
          maxLength={MAX_STUDENT_TEXT}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {busy ? (
          <button type="button" className="agent-stop" onClick={abort} aria-label="Avbryt" title="Avbryt">
            <StopIcon />
          </button>
        ) : (
          <button type="submit" className="btn-accent agent-send" disabled={!draft.trim()} aria-label="Send" title="Send">
            <SendIcon />
          </button>
        )}
      </form>
      {import.meta.env?.DEV && costUsd > 0 && <p className="agent-cost muted">Kostnad i samtalen: {costUsd.toFixed(4)} USD</p>}
    </section>
  );
}
