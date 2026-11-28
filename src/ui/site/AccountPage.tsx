/** /konto: abonnement, ukens bruk og adressen til connectoren. */
import { useEffect, useState } from "react";
import { accountStatus, useAuth, type AccountStatus } from "../auth/auth.js";
import { LoginForm } from "../auth/LoginForm.js";
import { SiteFooter, SiteHeader } from "./SiteHeader.js";

/** Adressen studentene legger til som connector i Claude. */
export function connectorUrl(): string {
  return typeof window === "undefined" ? "/mcp" : `${window.location.origin}/mcp`;
}

const FREE_TASKS = Number((import.meta.env as Record<string, string | undefined>).VITE_QUOTA_TASKS_PER_WEEK) || 5;

export function AccountPage() {
  const status = useAuth((s) => s.status);
  const email = useAuth((s) => s.user?.email);
  const [account, setAccount] = useState<AccountStatus | null>(null);
  useEffect(() => {
    if (status !== "signedIn") return;
    let live = true;
    void accountStatus().then((a) => live && setAccount(a ?? null));
    return () => {
      live = false;
    };
  }, [status]);

  return (
    <div className="site">
      <SiteHeader />
      <main className="narrow">
        <section className="card login-card">
          <h1 className="card-title">Konto</h1>
          {status === "signedOut" ? (
            <>
              <p>Logg inn for å se kontoen din.</p>
              <LoginForm next="/konto" />
            </>
          ) : status !== "signedIn" ? (
            <p className="muted">{status === "disabled" ? "Innlogging er ikke satt opp i denne versjonen." : "Laster …"}</p>
          ) : (
            <>
              <p>Logget inn som {email}.</p>
              {account &&
                (account.subscribed ? (
                  <p className="status-pill">Abonnement aktivt{account.periodEnd ? ` til ${new Date(account.periodEnd).toLocaleDateString("nb-NO")}` : ""}</p>
                ) : (
                  <p>
                    Gratis: {account.tasksThisWeek} av {FREE_TASKS} oppgaver brukt denne uken. Abonnement kommer snart.
                  </p>
                ))}
              <h2>Bruk i Claude</h2>
              <p>
                Legg til en egen connector i Claude med adressen <code className="start-url">{connectorUrl()}</code>.
              </p>
            </>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
