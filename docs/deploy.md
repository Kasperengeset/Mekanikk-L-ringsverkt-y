# Publisering på Vercel

Appen består av to deler:

- **Statiske filer** fra `pnpm build` (mappen `dist/`): forsiden, verktøyet, innlogging, konto og samtykke.
- **To serverløse funksjoner:** `api/mcp.ts` (MCP-serveren på `/mcp`) og `api/oauth-protected-resource.ts`
  (OAuth-metadata på `/.well-known/…`). Node-runtime med standard `Request`/`Response`. Se [mcp.md](mcp.md).

Innstillingene for bygging og funksjoner står i `vercel.json`, så de trenger ikke settes i dashbordet.

## Første gang

1. Logg inn på vercel.com og velg **Add New → Project**. Importer GitHub-repoet
   `Kasperengeset/Mekanikk-L-ringsverkt-y`.
2. Legg inn miljøvariablene under (**Settings → Environment Variables**), både for Production og Preview.
3. Trykk **Deploy**. Hver push lager deretter en preview-deploy, og `main` går til produksjon.
4. Prøv: åpne `<url>/app?eksempel=bjelke`, og legg til `<url>/mcp` som connector i Claude.

| Variabel | Verdi | Merknad |
| --- | --- | --- |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` | Vercel bruker da pnpm 11.8.0 fra `packageManager` i `package.json`, samme som lokalt og i CI. |
| `VITE_SUPABASE_URL` | `https://<prosjekt>.supabase.co` | Innlogging (se [auth.md](auth.md)) og MCP-tokens. Uten den er MCP-serveren åpen. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | Offentlig nøkkel; havner i nettleseren. |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` | Hemmelig; bare på serveren. Teller kvoten. Påkrevd når innloggingen er på. |
| `QUOTA_TASKS_PER_WEEK` / `VITE_QUOTA_TASKS_PER_WEEK` | `5` | Valgfri. Gratis oppgaver per uke i MCP-serveren / tallet som vises på /konto. |
| `PUBLIC_URL` | `https://moment.no` | Valgfri. Fast offentlig adresse i lenker og OAuth-metadata. |
| `VITE_CONTACT_EMAIL` | adressen | Valgfri. Står på personvernsiden for sletting av bruker. |

`ANTHROPIC_API_KEY` og `ACCESS_CODES` brukes ikke lenger av appen (Claude kjører hos studenten, se
[mcp.md](mcp.md)) og kan slettes i Vercel.

## Kostnad

Appen kaller ikke Claude selv lenger; Claude-bruken betales av studentens eget abonnement. Det som koster
hos oss, er Vercel og Supabase, begge på gratisplan så langt.

## Grenser

- **Varighet:** `maxDuration` er 30 s. Verktøyene svarer på millisekunder; taket er bare en sikring.
- **Kursmaterialet** (`testset/ov*`, øvinger og løsningsforslag) er utelatt fra både git og
  `vercel deploy` (`.gitignore` og `.vercelignore`), og kommer aldri med i en deploy.

## Importene i server-koden

Vercel oversetter hver TypeScript-fil i `api/` for seg, uten bundling, og kjører resultatet som ESM i
Node. Derfor skrives alle relative importer med `.js` (`../server/platform/mcp.js`), og JSON-importer med
`with { type: "json" }`. `pnpm check:api` gjør det samme som Vercel: den laster funksjonene i ren Node og
kaller dem uten Supabase-nøkler, så ingenting går mot nettverket. Sjekken kjøres i CI.
