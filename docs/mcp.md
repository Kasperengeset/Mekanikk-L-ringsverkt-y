# MCP-serveren

Studentene bruker Mekanikk-intuisjon fra sin egen Claude: de legger til `https://<domene>/mcp` som egen
connector, logger inn med brukeren sin hos oss, og Claude kaller verktøyene våre. Claude tolker oppgaven
(betalt av studentens abonnement); alle tall kommer fra løseren i `src/core`.

## Oppbygning

| Fil | Hva |
| --- | --- |
| `api/mcp.ts` | Vercel-funksjonen. Streamable HTTP, tilstandsløs: én server per forespørsel, JSON-svar, GET/DELETE gir 405. |
| `api/oauth-protected-resource.ts` | RFC 9728-metadata på `/.well-known/oauth-protected-resource(/mcp)`: peker på Supabase som autorisasjonsserver. |
| `server/platform/mcp.ts` | Generisk: fagmoduler, CORS, token → bruker, kvote. |
| `server/platform/oauth.ts` | Validerer Supabase-tokens lokalt mot JWKS (ES256), utsteder `<supabase>/auth/v1`, publikum `authenticated`. |
| `server/platform/entitlements.ts` | Abonnement og ukekvote via `consume_task` (`supabase/migrations/0002_entitlements.sql`). |
| `server/modules/mechanics/tools.ts` | Mekanikk-verktøyene: `force_system`, `solve_structure`. |
| `src/ui/site/ConsentPage.tsx` | `/oauth/samtykke`: studenten godkjenner at Claude får tilgang. |
| `src/ui/embed/` | Visningen i chatten (MCP Apps): kraftsystemet, eller konstruksjonen med diagrammer og snitt i 3D. |
| `vite.embed.config.ts` | Bygger visningen til én HTML-fil, `dist/mcp-ui/visning.html` (alt inlinet). |

En ny fagmodul er en `SubjectModule` (`id`, `instructions`, `tools`) som legges i listen i `api/mcp.ts`.

**Kvote.** Gratisbrukere får `QUOTA_TASKS_PER_WEEK` oppgaver per uke (standard 5). En oppgave telles én
gang uansett hvor mange ganger Claude kaller verktøyet for den: nøkkelen er en hash av geometrien
(konstruksjon) eller kreftenes navn (kraftsystem). Aktivt abonnement (`subscriptions`) gir fri bruk.

**Hva Claude ser, og hva visningen viser.** Claude leser tekstinnholdet i svaret. `structuredContent` har de
samme tallene maskinlesbart pluss modellen (`view: "forces" | "structure"`). Verktøyene peker på
ressursen `ui://mekanikk/visning.html` (`_meta.ui.resourceUri`), som Claude viser i chatten. Visningen kjører
løseren i nettleseren, så dra og snitt oppdaterer diagrammene uten nye kall. Serveren henter HTML-filen fra
nettstedet (`/mcp-ui/visning.html`) og bufrer den. Lenken «Åpne i moment.no» har modellen komprimert i
adressen (`#m=…`), så ingenting lagres hos oss.

Se visningen lokalt uten Claude: `pnpm dev`, så `http://localhost:5199/embed.html?demo=forces` eller
`?demo=gerber` (et hvilket som helst eksempel).

## Oppsett i Supabase (én gang)

1. SQL Editor: kjør `supabase/migrations/0002_entitlements.sql`.
2. Authentication → OAuth Server: slå på OAuth-serveren.
   - **Authorization Path:** `/oauth/samtykke`. Full adresse blir Site URL + stien, så Site URL må være
     produksjonsadressen.
   - **Allow Dynamic OAuth Apps (dynamisk klientregistrering):** på. Claude registrerer seg selv.
3. Sjekk at `https://<prosjekt>.supabase.co/.well-known/oauth-authorization-server/auth/v1` svarer.

## Prøv lokalt

- `pnpm dev`, deretter `npx @modelcontextprotocol/inspector` mot `http://localhost:5199/mcp`. Uten
  Supabase-variablene i `.env` er serveren åpen.
- Eller med curl:
  `curl -s -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' localhost:5199/mcp -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`

## Koble til Claude

claude.ai → Innstillinger → Connectors → Legg til egen connector → `https://<domene>/mcp`. Claude
oppdager innloggingen selv (401 → metadata → Supabase), sender studenten til `/oauth/samtykke`, og
verktøyene dukker opp i chatten. Claude Free tillater én egen connector.

## Tester

- `tests/mcp.test.ts`: ekte Streamable HTTP med SDK-klienten, OAuth med testnøkkel, kvote med falsk Supabase.
- `tests/forces.test.ts`: kraftsystemer, og `testset/ov01-1` (Øving 1 oppg. 1) når kursmaterialet ligger lokalt.
- `pnpm check:api`: funksjonene i `api/` lastes og svarer slik Vercel kjører dem.
