# Publisering på Vercel

Appen består av to deler:

- **Statiske filer** fra `pnpm build` (mappen `dist/`): forsiden, verktøyet, innlogging, konto og samtykke.
- **Serverløse funksjoner:** `api/interpret.ts` (tolkning) og `api/agent.ts` (veilederen) for webappen, som
  strømmer svaret som Server-Sent Events, og `api/mcp.ts` (MCP-serveren på `/mcp`) med
  `api/oauth-protected-resource.ts` (OAuth-metadata), for studenter som bruker oss fra Claude. Se [mcp.md](mcp.md).

Innstillingene for bygging og funksjoner står i `vercel.json`, så de trenger ikke settes i dashbordet.

## Første gang

1. Logg inn på vercel.com og velg **Add New → Project**. Importer GitHub-repoet
   `Kasperengeset/Mekanikk-L-ringsverkt-y`.
2. Legg inn miljøvariablene under (**Settings → Environment Variables**), både for Production og Preview.
3. Trykk **Deploy**. Hver push lager deretter en preview-deploy, og `main` går til produksjon.
4. Prøv: åpne `<url>/app?eksempel=bjelke` (gratis), last opp en oppgave (ca. 0,05 USD per tolkning), spør
   veilederen, og legg til `<url>/mcp` som connector i Claude.

| Variabel | Verdi | Merknad |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | nøkkelen | Påkrevd for tolkning og veileder i webappen. MCP-serveren trenger den ikke. |
| `ACCESS_CODES` | `ola-7f3k, kari-9x2m` | Valgfri. Tilgangskoder for testbrukere (slipper forbi innlogging og kvote). |
| `INTERPRET_MODEL`, `INTERPRET_EFFORT`, `INTERPRET_CONSISTENCY` | `claude-opus-5-5`, `high`, `low_confidence` | Valgfri. |
| `AGENT_MODEL`, `AGENT_EFFORT` | `claude-opus-5-5`, `medium` | Valgfri. |
| `QUOTA_INTERPRET_PER_WEEK`, `QUOTA_AGENT_PER_WEEK` | `10`, `60` | Valgfri. Gratis tolkninger og spørsmål til veilederen per uke. |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` | Vercel bruker da pnpm 11.8.0 fra `packageManager` i `package.json`, samme som lokalt og i CI. |
| `VITE_SUPABASE_URL` | `https://<prosjekt>.supabase.co` | Innlogging (se [auth.md](auth.md)) og MCP-tokens. Uten den er MCP-serveren åpen. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | Offentlig nøkkel; havner i nettleseren. |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` | Hemmelig; bare på serveren. Teller kvoten. Påkrevd når innloggingen er på. |
| `QUOTA_TASKS_PER_WEEK` / `VITE_QUOTA_TASKS_PER_WEEK` | `5` | Valgfri. Gratis oppgaver per uke i MCP-serveren / tallet som vises på /konto. |
| `PUBLIC_URL` | `https://<domene>` | Valgfri. Fast offentlig adresse i lenker og OAuth-metadata. |
| `VITE_CONTACT_EMAIL` | adressen | Valgfri. Står på personvernsiden for sletting av bruker. |

## Kostnad

- Webappen kaller Claude med din nøkkel: ca. 0,05 USD per tolkning og opptil ca. 0,08 USD per veiledersvar.
  Ukekvoten per bruker holder taket. Lag en egen nøkkel i Anthropic Console med månedlig forbruksgrense.
- Via MCP (Claude hos studenten) betaler studentens eget abonnement for Claude; hos oss koster det bare
  Vercel og Supabase.

## Grenser

- **Størrelse på forespørselen:** Vercel avviser forespørsler over 4,5 MB. Klienten holder bildene under
  ca. 4 MB samlet (base64), se `imageByteBudget` i `src/ui/upload/logic.ts`.
- **Varighet:** `maxDuration` er 300 s (tolkning med self-consistency kan ta tid). MCP-verktøyene svarer på
  millisekunder.
- **Kursmaterialet** (`testset/ov*`, øvinger og løsningsforslag) er utelatt fra både git og
  `vercel deploy` (`.gitignore` og `.vercelignore`), og kommer aldri med i en deploy.

## Importene i server-koden

Vercel oversetter hver TypeScript-fil i `api/` for seg, uten bundling, og kjører resultatet som ESM i
Node. Derfor skrives alle relative importer med `.js` (`../server/platform/mcp.js`), og JSON-importer med
`with { type: "json" }`. `pnpm check:api` gjør det samme som Vercel: den laster funksjonene i ren Node og
kaller dem uten Supabase-nøkler, så ingenting går mot nettverket. Sjekken kjøres i CI.
