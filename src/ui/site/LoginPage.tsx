/** /logg-inn: logg inn eller opprett bruker (samme skjema). Er studenten allerede logget inn, går hen til verktøyet. */
import { useEffect } from "react";
import { useAuth } from "../auth/auth.js";
import { LoginForm } from "../auth/LoginForm.js";
import { navigate, useLocation } from "../router.js";
import { SiteFooter, SiteHeader } from "./SiteHeader.js";

/** Bare interne stier godtas som mål etter innlogging. */
export function safeNext(search: string): string {
  const next = new URLSearchParams(search).get("neste") ?? "/app";
  return /^\/[a-z0-9/-]*$/i.test(next) && !next.startsWith("//") ? next : "/app";
}

export function LoginPage() {
  const { search } = useLocation();
  const status = useAuth((s) => s.status);
  const next = safeNext(search);
  useEffect(() => {
    if (status === "signedIn") navigate(next, { replace: true });
  }, [status, next]);
  return (
    <div className="site">
      <SiteHeader />
      <main className="narrow">
        <section className="card login-card">
          <h1 className="card-title">Logg inn eller opprett bruker</h1>
          <p className="muted">
            Med bruker kan du laste opp dine egne oppgaver og spørre veilederen. Du får en gratis kvote hver uke. Eksemplene kan du prøve uten bruker.
          </p>
          <LoginForm next={next} />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
