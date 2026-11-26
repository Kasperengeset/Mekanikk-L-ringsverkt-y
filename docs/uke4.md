# Uke 4: agent og pedagogikk – arbeidsdeling

Fundamentet (grenen `uke4-fundament`) definerer reglene og grensesnittene. To spor bygger parallelt.

## Eierskap

| Del | Filer |
|---|---|
| Fundament | `src/core/**` (bl.a. `pedagogy.ts`, `llm/agent.ts`), `src/ui/state/**`, `src/ui/panel/**`, `src/ui/App.tsx` og resten av uke 3-fundamentet. Endres ikke av sporene; nødvendige endringer holdes minimale og nevnes i rapporten. **Systemprompten og verktøyskjemaene i `src/core/llm/agent.ts` endres bare etter avtale.** |
| D – agenten | `api/agent.ts`, `server/agent*.ts`, `src/ui/agent/**`, `vite.config.ts` (bare montering av `/api/agent`), `tests/agent*.test.ts(x)` |
| E – pedagogikk i visningen | `src/ui/pedagogy/**`, `src/ui/diagrams/**` (skjuling og utheving), `tests/pedagogy-ui*.test.ts(x)`, `tests/diagrams*.test.ts(x)` |

## Regler (src/core/pedagogy.ts)

- `askedTargets(model, result)`: ett mål per punkt i `model.asked`, med fasit i oppgavens enheter.
- `checkAttempt(target, attempt)`: 2 % toleranse; skiller riktig, feil retning og feil.
- `hiddenValues(model, store.attempts)`: hva som er skjult. Spørres det etter en opplagerkraft, skjules alle
  reaksjoner og alle diagramtall (de gir svaret via likevekt). Formene vises alltid.
- Forsøk lagres med `store.recordAttempt(index, { values, at })`. Diagrammer: `values: null` (egenvurdering).

## Agenten (src/core/llm/agent.ts)

- `AGENT_SYSTEM_PROMPT` og `AgentTools` (Zod) / `AGENT_TOOLS` (JSON Schema): `get_state`, `set_param`,
  `add_control`, `highlight`, `ask_prediction`.
- `stateSummary(model, result, attempts, extra)` er det `get_state` returnerer; skjulte tall er allerede fjernet.
- Verktøyene kjøres i nettleseren: `store.edit`, `store.addControl`, `store.setHighlights` /
  `store.setDiagramHighlight`, og `requestPrediction()` (`src/ui/state/prediction.ts`), som venter på
  `store.answerPrediction`.

## Verktøy

Som i uke 3: `pnpm dev` (`/?eksempel=gerber`), `pnpm snapshot`, `pnpm typecheck && pnpm lint && pnpm test`.
jsdom 29 virker nå lokalt (`// @vitest-environment jsdom` øverst i en testfil). Ingen kall mot det ekte Claude-API-et.
