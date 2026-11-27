import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { captureAccessCodeFromUrl } from "./api/access.js";
import "./styles.css";

// Før appen leser adressen (?eksempel=), så ?kode= er borte fra adresselinjen med en gang.
captureAccessCodeFromUrl();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
