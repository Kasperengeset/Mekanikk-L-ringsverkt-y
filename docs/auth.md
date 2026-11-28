# Innlogging og kvote (Supabase)

Studentene logger inn med en lenke på e-post (uten passord) eller med Google. Første innlogging oppretter
brukeren. Eksemplene virker uten bruker; egne oppgaver og veilederen krever innlogging og trekker fra en
gratis ukekvote. Testbrukere med tilgangskode (`ACCESS_CODES`) slipper forbi uten kvote.

Uten `VITE_SUPABASE_URL` og `VITE_SUPABASE_PUBLISHABLE_KEY` er innloggingen av og alt virker som før.

## Slik henger det sammen

- Nettleseren (`src/ui/auth/auth.ts`) logger inn med Supabase Auth og sender tokenet i `Authorization`.
- Serveren (`server/gate.ts`) sjekker tokenet mot Supabase og trekker kvoten med funksjonen
  `consume_quota` (`supabase/migrations/0001_usage.sql`). Bare den hemmelige nøkkelen kan kalle den.
- Én tolkning teller 1. Et spørsmål fra studenten til veilederen teller 1. Verktøyrundene veilederen
  tar på egen hånd teller mot et høyere tak (7 × spørsmålskvoten), så en løpsk samtale stopper.
- Uken går fra mandag til søndag, norsk tid.
- Feiler kontakten med Supabase, stoppes forespørselen (503) i stedet for å bruke Claude uten kvote.

## Oppsett (én gang)

1. **Prosjekt.** Opprett et prosjekt på supabase.com. Velg en region i EU (f.eks. Stockholm eller
   Frankfurt); personvernsiden sier at dataene ligger i EU.
2. **Tabellen og funksjonen.** Åpne SQL Editor og kjør hele `supabase/migrations/0001_usage.sql`.
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
- `/app`: opplastingen ber om innlogging; eksemplene virker uten.
- Logg inn med e-post; lenken åpner `/app` innlogget, og e-postadressen står øverst.
- Tolk en oppgave; i Supabase (Table Editor → usage) står det en rad med `interpret` og `used = 1`.
- Uten innlogging svarer API-et 401 med koden `login`:
  `curl -s -X POST https://…/api/interpret -H 'content-type: application/json' -d '{}'`

## Slette en bruker

Authentication → Users → slett brukeren. Raden i `usage` slettes automatisk (`on delete cascade`).
