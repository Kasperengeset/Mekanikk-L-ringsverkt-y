# Mekanikk-intuisjonsverktøy

Interaktivt læringsverktøy for 2D-statikk. Studenten laster opp en oppgave, Claude lager en strukturert
modell av den, og alt som vises, regnes deterministisk fra modellen. Som tillegg finnes en MCP-server
(`/mcp`, se `docs/mcp.md`), så studenter kan bruke verktøyene fra sin egen Claude.
Spesifikasjonen ligger i `docs/spesifikasjon.pdf`.

## Kom i gang

```
pnpm install
cp .env.example .env        # fyll inn ANTHROPIC_API_KEY; Supabase er valgfritt lokalt
pnpm test                   # enhetstester
pnpm testset:check          # sjekker fasitmodellene i testset/
pnpm dev                    # webappen og MCP-serveren på http://localhost:5199/mcp
pnpm eval:interpret --examples --consistency never   # måling av tolkningen (koster litt, trenger ANTHROPIC_API_KEY)
```

## Struktur

| Mappe | Innhold |
|---|---|
| `src/core/` | Ren TypeScript uten React eller nettverk. Brukes av nettleseren, testene og eval-skriptet. |
| `src/core/schema.ts` | Modellskjemaet (Zod). Den eneste kontrakten mellom LLM, løser og visning. |
| `src/core/validate.ts` | Referanser, geometri og statisk ubestemthetsgrad. |
| `src/core/compare.ts` | Sammenligner to modeller entitet for entitet (eval og self-consistency). |
| `src/core/consistency.ts` | Velger tolkningen flest er enige i, og markerer uenighet. |
| `src/core/solver/` | Løseren: direkte stivhetsmetode, ledd, skrå opplagre, eksakte snittkrefter, mekanismesjekk og likevektskontroll. |
| `src/core/forces.ts` | Kraftsystemer: dekomponering, resultant, moment og likevekt. |
| `src/core/cut.ts`, `stress.ts` | Snitt og frie legemer; spenninger σ og τ i tverrsnittet. |
| `server/platform/` | Generisk MCP-lag: Streamable HTTP, OAuth-ressursserver (Supabase), abonnement og kvote. |
| `server/modules/mechanics/` | Mekanikk-verktøyene (`force_system`, `solve_structure`). |
| `api/` | Vercel-funksjonene: `interpret.ts`, `agent.ts`, `mcp.ts` og OAuth-metadataene. |
| `src/pdf/render.ts` | PDF-sider til bilder, felles for nettleser og eval. |
| `eval/anastruct/` | Uavhengig referanse for løseren (Python, anaStruct). |
| `src/core/llm/`, `server/llm/`, `server/interpret.ts` | Tolkning med Claude (webappen og målingen i `eval/`). |
| `server/interpretHandler.ts`, `server/agentHandler.ts`, `server/gate.ts` | `/api/interpret` og `/api/agent`: tolkning, veileder, innlogging og kvote. |
| `eval/` | Måling av tolkningen og innlesing av testsettet. |
| `testset/` | Oppgaver med fasitmodeller. Se `testset/README.md`. |
| `src/ui/` | Webappen: forside, verktøyet (`/app`), innlogging, konto, OAuth-samtykke. |

## Status

- **Uke 1 / Port 1:** med prompt `7a74cac12d27` (tverrsnitt som form) ble 21 av 21 holdout-oppgaver og
  10 av 10 tuning-oppgaver tolket helt riktig. Forrige prompt (`8f99ae83aad1`) ga 20 av 21, der avviket
  var en feil i fasiten.
- **Uke 2 / Port 2:** løseren stemmer med anaStruct på alle 35 oppgaver i testsettet innenfor 1e-6
  relativt, også statisk ubestemte. Største oppgave (42 frihetsgrader) løses på 0,24 ms.
- **Deformasjon og tverrsnitt:** eksakt nedbøyning w(x) og lengdeendring u(x) langs hvert element.
  Tverrsnitt kan gis som form (rektangel, sirkel, rør, IPE-profil, sammensatt), og A og I regnes ut av
  appen. Kontrollert mot svarantydningene i øving 9, 11, 12 og 13.
- **Uke 3:** konstruksjonsvisning med dra og klikk, N-, V- og M-diagram, deformert form, opplasting av
  bilde/PDF/tekst med strømmet tolkning (`/api/interpret`) og bekreftelsessteg.
- **Uke 4:** veilederen (`/api/agent`) med verktøyene get_state, set_param, add_control, highlight og
  ask_prediction; «Prøv selv» der tallene for det oppgaven spør om vises først etter et eget forsøk;
  glidebrytere og spådomskort. Prøvd ende til ende med ekte nøkkel.
- **Vercel:** klart til publisering (`vercel.json`, `pnpm check:api` i CI). Tilgangskoder per
  testbruker (`ACCESS_CODES`, personlig lenke med `?kode=`) holder API-et lukket for andre.
  Fremgangsmåte og miljøvariabler står i `docs/deploy.md`.
- **Design:** visningen følger designet i `docs/design/Mekanikk-intuisjon.html`. Kremhvit side, hvite
  kort, mørkebrunt og oransje, Inter og Newsreader. Skriftene ligger i `public/fonts/` (OFL), så appen
  henter ingenting fra Google. Bare lyst tema.
- **Publisert:** https://mekanikk-l-ringsverkt-y.vercel.app
- **MCP som tillegg:** `/mcp` med OAuth mot Supabase, `force_system` og `solve_structure`, ukekvote og
  abonnement, og visning i Claude-chatten (MCP Apps). Webappen med tolkning og veileder er hovedveien.
  Se `docs/mcp.md`.

Referansene lages med `.venv/bin/python eval/anastruct/reference.py` etter
`python3 -m venv .venv && .venv/bin/pip install -r eval/anastruct/requirements.txt`.
