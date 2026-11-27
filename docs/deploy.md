# Publisering på Vercel

Appen består av to deler:

- **Statiske filer** fra `pnpm build` (mappen `dist/`). Der ligger også pdf.js-filene i `dist/pdfjs/`.
- **To serverløse funksjoner:** `api/interpret.ts` (tolkning) og `api/agent.ts` (veilederen). De bruker
  Node-runtime med standard `Request`/`Response` og strømmer svaret som Server-Sent Events.

Innstillingene for bygging og funksjoner står i `vercel.json`, så de trenger ikke settes i dashbordet.

## Første gang

1. Logg inn på vercel.com og velg **Add New → Project**. Importer GitHub-repoet
   `Kasperengeset/Mekanikk-L-ringsverkt-y`.
2. Legg inn miljøvariablene under (**Settings → Environment Variables**), både for Production og Preview.
3. Trykk **Deploy**. Hver push lager deretter en preview-deploy, og `main` går til produksjon.
4. Prøv:
   - Åpne `<url>/?eksempel=bjelke` (ingen kostnad).
   - Last opp en oppgave (ca. 0,05 USD per tolkning).
   - Spør veilederen. Et svar med fem verktøykall kostet 0,08 USD i testen. Korte svar uten verktøykall
     koster mindre.

| Variabel | Verdi | Merknad |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | nøkkelen | Påkrevd. Uten den svarer funksjonene med en forklarende feilmelding. |
| `ACCESS_CODES` | `ola-7f3k, kari-9x2m` | Tilgangskoder, én per testbruker (se under). Uten denne er API-et åpent for alle som har adressen. |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` | Vercel bruker da pnpm 11.8.0 fra `packageManager` i `package.json`, samme som lokalt og i CI. |
| `INTERPRET_MODEL` | `claude-opus-5-5` | Valgfri. |
| `INTERPRET_EFFORT` | `high` | Valgfri. |
| `INTERPRET_CONSISTENCY` | `low_confidence` | Valgfri: `never`, `low_confidence` eller `always`. Ved `low_confidence` kan kostnaden bli tre ganger så høy for usikre oppgaver. |
| `AGENT_MODEL` | `claude-opus-5-5` | Valgfri. |
| `AGENT_EFFORT` | `medium` | Valgfri. |

## Tilgangskoder og personlige lenker

Adressen er offentlig. Med `ACCESS_CODES` satt avviser `/api/interpret` og `/api/agent` alle
forespørsler uten en gyldig kode (401) før noe sendes til Claude. Eksemplene (`?eksempel=…`) virker
uten kode, siden de ikke bruker API-et.

1. Lag én kode per testbruker. Bruk bokstavene a–z, tall, bindestrek og understrek, for eksempel
   navn pluss noen tilfeldige tegn: `node -e "console.log('ola-' + require('crypto').randomBytes(3).toString('hex'))"`.
2. Legg kodene i `ACCESS_CODES`, skilt med komma, og deploy på nytt. Endringer i miljøvariabler gjelder
   først etter en ny deploy.
3. Send hver testbruker sin personlige lenke: `https://<adresse>/?kode=ola-7f3k`. Appen lagrer koden i
   nettleseren og fjerner den fra adresselinjen. Mangler koden, eller er den feil, ber appen om den og
   sender forespørselen på nytt når den er skrevet inn.
4. For å stenge ute én testbruker fjerner du koden fra listen og deployer på nytt.

Store og små bokstaver regnes som like.

## Kostnad

- Lag et eget arbeidsområde (workspace) og en egen nøkkel i Anthropic Console, med en månedlig
  forbruksgrense. Da blir det verste tilfellet en kjent sum, også om en kode kommer på avveie.
- Vurder `INTERPRET_CONSISTENCY=never` under testen. Det er billigst, men usikre tolkninger får da
  ikke spørsmål fra self-consistency.

## Grenser

- **Størrelse på forespørselen:** Vercel avviser forespørsler over 4,5 MB. Klienten holder bildene under
  ca. 4 MB samlet (base64), se `imageByteBudget` i `src/ui/upload/logic.ts`. Et 413-svar vises som
  «Bildene er for store».
- **Varighet:** `maxDuration` er 300 s for begge funksjonene. Det er taket på Hobby-planen med Fluid
  compute, som er standard for nye prosjekter. Uten Fluid compute er taket på Hobby 60 s, og da kan en
  tolkning med self-consistency bli avbrutt. Mens Claude tenker, sender funksjonene hjerteslag, så
  forbindelsen holdes åpen.
- **Kursmaterialet** (`testset/ov*`, øvinger og løsningsforslag) er utelatt fra både git og
  `vercel deploy` (`.gitignore` og `.vercelignore`), og kommer aldri med i en deploy.

## Importene i server-koden

Vercel oversetter hver TypeScript-fil i `api/` for seg, uten bundling, og kjører resultatet som ESM i
Node. Derfor skrives alle relative importer med `.js` (`../server/agentHandler.js`), og JSON-importer med
`with { type: "json" }`. `pnpm check:api` gjør det samme som Vercel: den laster funksjonene i ren Node og
kaller dem uten API-nøkkel, så det går ingen kall til Claude. Sjekken kjøres i CI.
