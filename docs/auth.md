# Innlogging og kvote (Supabase)

Studentene logger inn med en lenke på e-post (uten passord) eller med Google. Første innlogging oppretter
brukeren. Den samme innloggingen brukes når Claude kobles til MCP-serveren (OAuth, se [mcp.md](mcp.md)).
Eksemplene i webappen virker uten bruker.

Uten `VITE_SUPABASE_URL` og `VITE_SUPABASE_PUBLISHABLE_KEY` er innloggingen av og alt virker som før.

## Slik henger det sammen

- Nettleseren (`src/ui/auth/auth.ts`) logger inn med Supabase Auth.
- Claude får et OAuth-token fra Supabase (OAuth 2.1 Server) etter at studenten har godkjent på
  `/oauth/samtykke`. MCP-serveren validerer tokenet og teller oppgaver (`server/platform/`).
- Uken går fra mandag til søndag, norsk tid.
- Feiler kontakten med Supabase, nektes verktøykallet i stedet for å slippe forbi kvoten.

## Oppsett (én gang)

1. **Prosjekt.** Opprett et prosjekt på supabase.com. Velg en region i EU (f.eks. Stockholm eller
   Frankfurt); personvernsiden sier at dataene ligger i EU.
2. **Tabellene og funksjonene.** Åpne SQL Editor og kjør migrasjonene i `supabase/migrations/` i rekkefølge.
3. **Nøklene.** Under Project Settings → API keys: kopier *Project URL*, en *publishable key* og en
   *secret key*.
4. **Adressene.** Under Authentication → URL Configuration:
   - Site URL: `https://mekanikk-l-ringsverkt-y.vercel.app` (eller det egne domenet).
   - Redirect URLs: `https://mekanikk-l-ringsverkt-y.vercel.app/**` og `http://localhost:5199/**`.
5. **E-post.** Supabase sin innebygde e-post er sterkt begrenset (noen få e-poster i timen) og bare
   ment for testing. Før studentene slippes inn: sett opp egen SMTP under Authentication → Emails
   (f.eks. Resend eller Postmark), og oversett malen «Magic Link» til norsk.
6. **Google (valgfritt).** Lag en OAuth-klient (Web application) i Google Cloud Console med
   redirect-URI `https://<prosjekt>.supabase.co/auth/v1/callback`, og lim inn klient-ID og hemmelighet
   under Authentication → Sign In / Providers → Google. Samtykkeskjermen krever en lenke til
   personvernsiden: `https://…/personvern`.
7. **Vercel.** Legg inn miljøvariablene (tabellen i [deploy.md](deploy.md)) og deploy på nytt.
   `SUPABASE_SECRET_KEY` må aldri få et navn som starter med `VITE_`, for da havner den i nettleseren.
8. **Lokalt.** Samme variabler i `.env`. Start `pnpm dev` på nytt etter endringer.

## Sjekk at det virker

- Forsiden viser «Logg inn» øverst til høyre.
- Logg inn med e-post; lenken åpner `/app` innlogget, og e-postadressen står øverst (lenke til `/konto`).
- Uten token svarer `/mcp` 401 med `WWW-Authenticate: Bearer resource_metadata=…`:
  `curl -si -X POST https://…/mcp -H 'content-type: application/json' -d '{}'`

## Slette en bruker

Authentication → Users → slett brukeren. Radene i `usage`, `task_usage` og `subscriptions` slettes
automatisk (`on delete cascade`).
