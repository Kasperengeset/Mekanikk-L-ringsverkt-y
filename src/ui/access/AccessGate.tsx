/** Ber om tilgangskoden når serveren har avvist en forespørsel, og kjører den på nytt når koden er lagret. */
import { useState, type FormEvent } from "react";
import { dismissAccess, isValidAccessCode, submitAccessCode, useAccess } from "../api/access.js";

export function AccessGate() {
  const message = useAccess((s) => s.message);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!message) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!isValidAccessCode(code)) {
      setError("Koden kan bare inneholde bokstavene a–z, tall, bindestrek og understrek.");
      return;
    }
    setError(null);
    setCode("");
    submitAccessCode(code);
  };

  return (
    <form className="access-gate" onSubmit={submit} aria-label="Tilgangskode">
      <p>{message}</p>
      <div className="access-gate-row">
        <label>
          Tilgangskode
          <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} required />
        </label>
        <button type="submit">Lagre og prøv igjen</button>
        <button type="button" onClick={dismissAccess}>
          Lukk
        </button>
      </div>
      {error && <p className="warning">{error}</p>}
    </form>
  );
}
