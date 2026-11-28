/**
 * Sidene: forsiden, verktøyet (lastes ved behov, så forsiden er rask), innlogging og personvern.
 */
import { lazy, Suspense } from "react";
import { useLocation, linkClick } from "./router.js";
import { Landing } from "./site/Landing.js";
import { LoginPage } from "./site/LoginPage.js";
import { PrivacyPage } from "./site/PrivacyPage.js";
import { SiteFooter, SiteHeader } from "./site/SiteHeader.js";
import "./site/site.css";

const App = lazy(() => import("./App.js").then((m) => ({ default: m.App })));

export function Root() {
  const { path } = useLocation();
  switch (path.replace(/\/+$/, "") || "/") {
    case "/":
      return <Landing />;
    case "/app":
      return (
        <Suspense fallback={<div className="page-loading muted">Laster verktøyet …</div>}>
          <App />
        </Suspense>
      );
    case "/logg-inn":
      return <LoginPage />;
    case "/personvern":
      return <PrivacyPage />;
    default:
      return <NotFound />;
  }
}

function NotFound() {
  return (
    <div className="site">
      <SiteHeader />
      <main className="narrow">
        <section className="card">
          <h1 className="card-title">Fant ikke siden</h1>
          <p>
            <a href="/" onClick={linkClick("/")}>
              Til forsiden
            </a>
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
