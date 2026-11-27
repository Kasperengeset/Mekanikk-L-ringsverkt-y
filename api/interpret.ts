/**
 * POST /api/interpret – serverløs funksjon for Vercel (Node-runtime, Web Request/Response).
 * Under `pnpm dev` monteres den samme handleren av Vite (se vite.config.ts).
 *
 * Miljø: ANTHROPIC_API_KEY (påkrevd), INTERPRET_MODEL, INTERPRET_EFFORT og INTERPRET_CONSISTENCY
 * (never | low_confidence | always) er valgfrie. ACCESS_CODES gir tilgangskoder (se server/access.ts).
 */
import { checkAccess } from "../server/access.js";
import { consistencyFromEnv, createInterpretHandler } from "../server/interpretHandler.js";
import { ClaudeProvider } from "../server/llm/claude.js";

export const POST = createInterpretHandler({
  authorize: (req) => checkAccess(req, process.env.ACCESS_CODES),
  createProvider: ({ onEvent, signal }) => new ClaudeProvider({ signal, ...(onEvent ? { onEvent } : {}) }),
  checkConfig: () =>
    process.env.ANTHROPIC_API_KEY ? undefined : "Tolkningen er ikke satt opp: ANTHROPIC_API_KEY mangler på serveren.",
  interpretOptions: consistencyFromEnv(),
});
