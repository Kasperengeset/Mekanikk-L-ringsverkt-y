/**
 * POST /api/agent – den pedagogiske veilederen, serverløs funksjon for Vercel (Node-runtime, Web Request/Response).
 * Under `pnpm dev` monteres den samme handleren av Vite (se vite.config.ts).
 *
 * Miljø: ANTHROPIC_API_KEY (påkrevd), AGENT_MODEL (standard claude-opus-5-5), AGENT_EFFORT (standard medium)
 * og ACCESS_CODES (tilgangskoder, se server/access.ts).
 */
import Anthropic from "@anthropic-ai/sdk";
import { checkAccess } from "../server/access.js";
import { agentConfigFromEnv, createAgentHandler } from "../server/agentHandler.js";

export const POST = createAgentHandler({
  createClient: () => new Anthropic(),
  authorize: (req) => checkAccess(req, process.env.ACCESS_CODES),
  checkConfig: () => (process.env.ANTHROPIC_API_KEY ? undefined : "Veilederen er ikke satt opp: ANTHROPIC_API_KEY mangler på serveren."),
  config: agentConfigFromEnv(),
});
