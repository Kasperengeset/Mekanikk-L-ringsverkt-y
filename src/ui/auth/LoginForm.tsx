/**
 * Skjemaet for å logge inn eller opprette bruker: lenke på e-post eller Google. Brukes på /logg-inn og
 * der verktøyet trenger innlogging (opplasting, veileder).
 */
import { useId, useState, type FormEvent } from "react";
import { linkClick } from "../router.js";
import { authEnabled, isValidEmail, signInWithEmail, signInWithGoogle } from "./auth.js";

export function LoginForm({ next = "/app", compact = false }: { next?: string; compact?: boolean }) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "sending" | "sent" } | { kind: "error"; message: string }>({ kind: "idle" });

  if (!authEnabled) return <p className="muted login-off">Innlogging er ikke satt opp i denne versjonen av appen.</p>;

  if (state.kind === "sent")
    return (
      <div className="login-sent" role="status">
        <p>
          <strong>Sjekk e-posten din.</strong> Vi har sendt en innloggingslenke til {email.trim()}. Åpne den på denne enheten, så er du logget inn.
        </p>
        <button type="button" className="btn-link" onClick={() => setState({ kind: "idle" })}>
          Bruk en annen e-postadresse
        </button>
      </div>
    );

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isValidEmail(email)) return setState({ kind: "error", message: "Skriv inn en gyldig e-postadresse." });
    setState({ kind: "sending" });
    const r = await signInWithEmail(email.trim(), next);
    setState(r.ok ? { kind: "sent" } : { kind: "error", message: r.message });
  };
  const google = async () => {
    const r = await signInWithGoogle(next);
    if (r) setState({ kind: "error", message: r.message });
  };

  return (
    <form className={`login-form${compact ? " compact" : ""}`} onSubmit={(e) => void onSubmit(e)} noValidate>
      <label htmlFor={`${id}-email`}>E-postadresse</label>
      <div className="login-row">
        <input
          id={`${id}-email`}
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="navn@stud.ntnu.no"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={state.kind === "error" || undefined}
          aria-describedby={state.kind === "error" ? `${id}-error` : undefined}
        />
        <button type="submit" className="primary" disabled={state.kind === "sending"}>
          {state.kind === "sending" ? "Sender …" : "Send innloggingslenke"}
        </button>
      </div>
      {state.kind === "error" && (
        <p id={`${id}-error`} className="login-error" role="alert">
          {state.message}
        </p>
      )}
      <div className="login-or" aria-hidden="true">
        <span>eller</span>
      </div>
      <button type="button" className="login-google" onClick={() => void google()}>
        <GoogleMark />
        Fortsett med Google
      </button>
      <p className="login-fine muted">
        Har du ikke bruker, opprettes den første gang du logger inn. Ingen passord. Se{" "}
        <a href="/personvern" onClick={linkClick("/personvern")}>
          personvern
        </a>
        .
      </p>
    </form>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}
