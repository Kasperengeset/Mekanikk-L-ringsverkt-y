/**
 * POST /api/agent – den pedagogiske veilederen, serverløs funksjon for Vercel (Node-runtime, Web Request/Response).
 * Under `pnpm dev` monteres den samme handleren av Vite (se vite.config.ts).
 *
 * Miljø: ANTHROPIC_API_KEY (påkrevd), AGENT_MODEL (standard claude-opus-5-5) og AGENT_EFFORT (standard medium).
 */
import Anthropic from "@anthropic-ai/sdk";
import { agentConfigFromEnv, createAgentHandler } from "../server/agentHandler.js";

export const POST = createAgentHandler({
  createClient: () => new Anthropic(),
  checkConfig: () => (process.env.ANTHROPIC_API_KEY ? undefined : "Veilederen er ikke satt opp: ANTHROPIC_API_KEY mangler på serveren."),
  config: agentConfigFromEnv(),
});
