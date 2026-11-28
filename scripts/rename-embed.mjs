// Vite kaller filen etter inngangen (embed.html); MCP-serveren henter den som /mcp-ui/visning.html.
import { renameSync } from "node:fs";
renameSync("dist/mcp-ui/embed.html", "dist/mcp-ui/visning.html");
