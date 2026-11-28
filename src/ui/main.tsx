import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { startAuth } from "./auth/auth.js";
import { Root } from "./Root.js";
import { legacyRedirect } from "./router.js";
import "./styles.css";

// Gamle lenker (/?eksempel=…, /?kode=…) gikk til verktøyet; det ligger nå på /app.
const moved = legacyRedirect(window.location.pathname, window.location.search);
if (moved) window.history.replaceState(null, "", moved);

// Leser også innloggingslenken (#access_token=…) og fjerner den fra adressen.
startAuth();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
