# Mekanikk-intuisjonsverktøy

Interaktivt læringsverktøy for 2D-statikk. Studenten laster opp en oppgave. En LLM lager en
strukturert modell av den, og alt som vises, regnes deterministisk fra modellen.
Spesifikasjonen ligger i `docs/spesifikasjon.pdf`.

## Kom i gang

```
pnpm install
cp .env.example .env        # fyll inn ANTHROPIC_API_KEY
pnpm test                   # enhetstester
pnpm testset:check          # sjekker fasitmodellene i testset/
pnpm eval:interpret --examples --consistency never   # tolkning av eksemplene (koster litt)
pnpm dev                    # frontend (plassholder til uke 3)
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
| `src/pdf/render.ts` | PDF-sider til bilder, felles for nettleser og eval. |
| `eval/anastruct/` | Uavhengig referanse for løseren (Python, anaStruct). |
| `src/core/llm/` | Prompter og verktøydefinisjoner. |
| `server/llm/` | Adapterlaget mot LLM-leverandøren (`claude.ts`) og pristabell. |
| `server/interpret.ts` | Tolkningsløpet med valgfri self-consistency. |
| `eval/` | Eval-skriptet for tolkningen og innlesing av testsettet. |
| `testset/` | Oppgaver med fasitmodeller. Se `testset/README.md`. |
| `src/ui/` | Frontend (uke 3). |

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
- **Neste:** første deploy, 5–10 testbrukere og betalingstest (Port 4).

Referansene lages med `.venv/bin/python eval/anastruct/reference.py` etter
`python3 -m venv .venv && .venv/bin/pip install -r eval/anastruct/requirements.txt`.
