/**
 * Inngangen til visningen i Claude (MCP Apps). Bygges til én HTML-fil (vite.embed.config.ts) som
 * MCP-serveren gir som ressursen ui://mekanikk/visning.html. Kobler til verten med App fra
 * @modelcontextprotocol/ext-apps og tegner structuredContent fra verktøysvaret.
 */
import { App } from "@modelcontextprotocol/ext-apps";
import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import { EmbedApp, type EmbedPayload } from "./EmbedApp.js";

let payload: EmbedPayload | null = null;
let pending = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

const app = new App({ name: "Mekanikk-intuisjon", version: "0.3.0" }, {}, { autoResize: true });
app.ontoolinput = () => {
  pending = true;
  emit();
};
app.ontoolresult = (result) => {
  payload = (result.structuredContent as EmbedPayload | undefined) ?? { message: "Verktøyet ga ingen figur." };
  pending = false;
  emit();
};

const actions = {
  openLink: (url: string) => void app.openLink({ url }).catch(() => window.open(url, "_blank", "noopener")),
  fullscreen: () => void app.requestDisplayMode({ mode: "fullscreen" }).catch(() => {}),
};

function Root() {
  const p = useSyncExternalStore(subscribe, () => payload);
  const busy = useSyncExternalStore(subscribe, () => pending);
  return <EmbedApp payload={p} actions={actions} pending={busy} />;
}

// Bare under `pnpm dev`: /embed.html?demo=forces eller ?demo=<eksempel> viser visningen uten Claude.
if (import.meta.env.DEV) {
  const demo = new URLSearchParams(window.location.search).get("demo");
  if (demo) void import("./demo.js").then((m) => ((payload = m.demoPayload(demo, window.location.origin)), emit()));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
void app.connect();
