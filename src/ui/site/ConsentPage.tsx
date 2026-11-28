/**
 * /oauth/samtykke: når studenten kobler Claude til Mekanikk-intuisjon, sender Supabase hit med
 * ?authorization_id=…. Studenten logger inn (hvis nødvendig) og godkjenner; da får Claude tilgang til
 * verktøyene på studentens vegne. Supabase OAuth 2.1 Server, se server/platform/oauth.ts.
 */
import { useEffect, useState } from "react";
import { oauthConsentDetails, oauthDecide, useAuth, type ConsentDetails } from "../auth/auth.js";
import { LoginForm } from "../auth/LoginForm.js";
import { useLocation } from "../router.js";
import { SiteFooter, SiteHeader } from "./SiteHeader.js";

const SCOPE_TEXT: Record<string, string> = {
  email: "se e-postadressen din",
  profile: "se navnet ditt",
  openid: "vite hvem du er",
  phone: "se telefonnummeret ditt",
};

export function ConsentPage() {
  const { path, search } = useLocation();
  const id = new URLSearchParams(search).get("authorization_id") ?? "";
  const status = useAuth((s) => s.status);
  const [details, setDetails] = useState<ConsentDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "signedIn" || !id) return;
    let live = true;
    void oauthConsentDetails(id).then((d) => {
      if (!live) return;
      if (d.kind === "redirect") window.location.assign(d.url);
      else setDetails(d);
    });
    return () => {
      live = false;
    };
  }, [status, id]);

  const decide = async (approve: boolean) => {
    setBusy(true);
    const r = await oauthDecide(id, approve);
    if ("url" in r) window.location.assign(r.url);
    else {
      setBusy(false);
      setError(r.error);
    }
  };

  let body;
  if (!id) body = <p>Lenken mangler forespørselen. Start tilkoblingen på nytt fra Claude.</p>;
  else if (status === "disabled") body = <p>Innlogging er ikke satt opp i denne versjonen.</p>;
  else if (status === "loading") body = <p className="muted">Laster …</p>;
  else if (status === "signedOut")
    body = (
      <>
        <p>Logg inn for å koble Claude til Mekanikk-intuisjon. Har du ikke bruker, opprettes den nå.</p>
        <LoginForm next={`${path}${search}`} />
      </>
    );
  else if (!details) body = <p className="muted">Henter forespørselen …</p>;
  else if (details.kind === "error") body = <p className="alert">{details.message}</p>;
  else if (details.kind === "consent")
    body = (
      <>
        <p>
          <strong>{details.clientName}</strong> vil bruke Mekanikk-intuisjon på dine vegne{details.email ? ` (${details.email})` : ""}. Den kan regne med
          verktøyene våre og bruke kvoten din.
        </p>
        {details.scopes.length > 0 && (
          <ul>
            {details.scopes.map((s) => (
              <li key={s}>{SCOPE_TEXT[s] ?? s}</li>
            ))}
          </ul>
        )}
        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}
        <div className="toolbar">
          <button type="button" className="primary" disabled={busy} onClick={() => void decide(true)}>
            Godkjenn
          </button>
          <button type="button" disabled={busy} onClick={() => void decide(false)}>
            Avslå
          </button>
        </div>
      </>
    );

  return (
    <div className="site">
      <SiteHeader />
      <main className="narrow">
        <section className="card login-card">
          <h1 className="card-title">Koble til Claude</h1>
          {body}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
