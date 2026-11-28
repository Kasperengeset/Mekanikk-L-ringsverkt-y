/** Topptekst for alle sidene: logoen (til forsiden), lenke til verktøyet og innlogging/konto. `children` står under (f.eks. tilgangskoden). */
import type { ReactNode } from "react";
import { signOut, useAuth } from "../auth/auth.js";
import { BrandMark } from "../icons.js";
import { linkClick, navigate, useLocation } from "../router.js";

export function SiteHeader({ children }: { children?: ReactNode }) {
  const { path } = useLocation();
  const status = useAuth((s) => s.status);
  const email = useAuth((s) => s.user?.email);
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <a className="brand" href="/" onClick={linkClick("/")} aria-label="Mekanikk-intuisjon, til forsiden">
          <BrandMark />
          <span className="brand-name">
            Mekanikk-<span>intuisjon</span>
          </span>
        </a>
        <nav className="site-nav" aria-label="Hovedmeny">
          {path !== "/app" && (
            <a className="site-nav-link" href="/app" onClick={linkClick("/app")}>
              Åpne verktøyet
            </a>
          )}
          {status === "signedIn" ? (
            <span className="site-account">
              <span className="site-email" title={email}>
                {email}
              </span>
              <button type="button" className="btn-link" onClick={() => void signOut().then(() => path === "/logg-inn" && navigate("/"))}>
                Logg ut
              </button>
            </span>
          ) : status === "signedOut" && path !== "/logg-inn" ? (
            <a className="site-nav-link strong" href="/logg-inn" onClick={linkClick("/logg-inn")}>
              Logg inn
            </a>
          ) : null}
        </nav>
        {children}
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <span>Mekanikk-intuisjon · statikk for byggstudenter</span>
        <a href="/personvern" onClick={linkClick("/personvern")}>
          Personvern
        </a>
        <span className="muted">Ikke tilknyttet NTNU.</span>
      </div>
    </footer>
  );
}
