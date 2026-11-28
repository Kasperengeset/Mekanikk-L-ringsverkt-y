/**
 * Opplasting og tolkning (fasen upload): dra og slipp, filvelger eller lim inn et bilde; PDF med
 * sidevalg; oppgavetekst og «Hvilken oppgave?». Under tolkningen vises fremdrift og Claudes
 * beskrivelse fortløpende. Resultatet går videre til bekreftelsessteget (ConfirmPanel).
 */
import { useEffect, useRef, useState, type DragEvent } from "react";
import { MAX_IMAGES } from "../api/protocol.js";
import { FIXTURES } from "../fixtures.js";
import { LoginPrompt, useNeedsLogin } from "../auth/LoginPrompt.js";
import { useStore } from "../state/store.js";
import { WarningIcon } from "../icons.js";
import { summarizePartial } from "./logic.js";
import {
  addFiles,
  appendText,
  cancelInterpretation,
  imageCount,
  MAX_THUMBNAILS,
  removeAttachment,
  setProblemText,
  setWhich,
  startInterpretation,
  togglePdfPage,
  useUploadSession,
  type Attachment,
} from "./session.js";
import "./upload.css";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,.pdf,.txt,.md";

export function UploadPanel() {
  const loadModel = useStore((s) => s.loadModel);
  const interpretation = useStore((s) => s.interpretation);
  const { attachments, problemText, which, notice, progress, busy } = useUploadSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLElement>(null);
  const [dragging, setDragging] = useState(false);
  const count = imageCount(attachments);
  const needsLogin = useNeedsLogin();

  // Fremdriften og beskrivelsen står under skjemaet; vis dem når tolkningen starter.
  useEffect(() => {
    if (busy) statusRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [busy]);

  // Lim inn et bilde fra utklippstavla hvor som helst på siden. Tekst limes inn i feltene som vanlig.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0 || useUploadSession.getState().busy) return;
      e.preventDefault();
      addFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length) addFiles(files);
    else appendText(e.dataTransfer.getData("text/plain"));
  };

  const partial = busy ? summarizePartial(interpretation.partial) : null;

  return (
    <div className="card upload">
      <h2 className="card-title">Last opp en oppgave</h2>
      <p className="muted">
        Et bilde eller en PDF av oppgaven, eller oppgaveteksten. Claude tolker oppgaven til en modell som du sjekker før du utforsker
        den. Alt som vises, regnes ut av appen.
      </p>

      {needsLogin ? (
        <LoginPrompt title="Logg inn for å laste opp egne oppgaver" text="Det er gratis, og du får en kvote med tolkninger hver uke. Eksemplene under kan du prøve uten bruker." />
      ) : (
        <>
      <fieldset className="upload-form" disabled={busy}>
        <div
          className={`dropzone${dragging ? " dragging" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <strong>Slipp en fil her, eller klikk for å velge</strong>
          <span>Du kan også lime inn et bilde (Ctrl+V eller ⌘V).</span>
          <span className="muted">PNG, JPEG, WebP, PDF eller tekst · høyst {MAX_IMAGES} bilder per tolkning</span>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />

        {attachments.length > 0 && (
          <ul className="attachments">
            {attachments.map((a) => (
              <AttachmentItem key={a.id} attachment={a} />
            ))}
          </ul>
        )}

        <label className="field">
          <span>Oppgavetekst (valgfritt)</span>
          <textarea
            rows={4}
            value={problemText}
            placeholder="Lim inn teksten hvis oppgaven finnes som tekst."
            onChange={(e) => setProblemText(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Hvilken oppgave? (valgfritt)</span>
          <input type="text" value={which} placeholder="f.eks. «Løs oppgave 2»" onChange={(e) => setWhich(e.target.value)} />
        </label>
      </fieldset>

      {notice && <p className="warning">{notice}</p>}

      <div className="toolbar">
        <button className="primary" onClick={() => void startInterpretation()} disabled={busy}>
          Tolk oppgaven{count > 0 ? ` (${count} ${count === 1 ? "bilde" : "bilder"})` : ""}
        </button>
        {busy && <button onClick={cancelInterpretation}>Avbryt</button>}
      </div>
        </>
      )}

      {(busy || interpretation.status === "error") && (
        <section className="interpretation" aria-live="polite" ref={statusRef}>
          {busy && progress && (
            <p className="progress">
              <span className="spinner" aria-hidden="true" /> {progress.message}
              {partial && <span className="muted"> ({partial})</span>}
            </p>
          )}
          {interpretation.status === "error" && (
            <div className="alert" role="alert">
              <WarningIcon />
              <span>{interpretation.error}</span>
            </div>
          )}
          {interpretation.description && (
            <div className="description">
              <h3>Claudes beskrivelse</h3>
              <p>{interpretation.description}</p>
            </div>
          )}
        </section>
      )}

      <section className="examples">
        <h3>Prøv et eksempel</h3>
        <div className="example-list">
          {Object.entries(FIXTURES).map(([key, f]) => (
            <button key={key} onClick={() => loadModel(f.model)} disabled={busy}>
              {f.title}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function AttachmentItem({ attachment: a }: { attachment: Attachment }) {
  if (a.kind === "image") {
    return (
      <li className="attachment">
        <img className="attachment-image" src={a.url} alt={a.name} />
        <span className="attachment-name">{a.name}</span>
        <button onClick={() => removeAttachment(a.id)}>Fjern</button>
      </li>
    );
  }
  return (
    <li className="attachment pdf">
      <div className="attachment-head">
        <span className="attachment-name">{a.name}</span>
        {a.status === "ready" && (
          <span className="muted">
            {a.numPages} {a.numPages === 1 ? "side" : "sider"} · {a.selected.length} valgt
          </span>
        )}
        <button onClick={() => removeAttachment(a.id)}>Fjern</button>
      </div>
      {a.status === "loading" && <p className="muted">Leser PDF-en …</p>}
      {a.status === "error" && <p className="warning">{a.error}</p>}
      {a.status === "ready" && a.numPages > 1 && <p className="muted">Velg sidene oppgaven står på (klikk for å velge eller fjerne).</p>}
      {a.thumbnails.length > 0 && (
        <div className="thumbs">
          {a.thumbnails.map((url, i) => {
            const page = i + 1;
            const selected = a.selected.includes(page);
            return (
              <button
                key={page}
                className={`thumb${selected ? " selected" : ""}`}
                aria-pressed={selected}
                title={`Side ${page}`}
                onClick={() => togglePdfPage(a.id, page)}
              >
                <img src={url} alt={`Side ${page}`} />
                <span>{page}</span>
              </button>
            );
          })}
        </div>
      )}
      {a.numPages > MAX_THUMBNAILS && <p className="muted">Viser de første {MAX_THUMBNAILS} sidene.</p>}
    </li>
  );
}
