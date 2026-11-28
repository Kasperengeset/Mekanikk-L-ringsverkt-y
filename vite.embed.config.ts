/**
 * Bygger visningen i Claude-chatten til én selvstendig HTML-fil (dist/mcp-ui/visning.html) med all JS
 * og CSS inlinet, slik MCP Apps krever (sandkassen henter ikke filer fra andre steder).
 */
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  publicDir: false,
  build: {
    outDir: "dist/mcp-ui",
    emptyOutDir: true,
    rollupOptions: { input: "embed.html" },
    chunkSizeWarningLimit: 4000,
  },
});
