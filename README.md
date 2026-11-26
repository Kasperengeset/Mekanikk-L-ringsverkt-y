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

- **Uke 1 / Port 1:** tolkningen ga 20 av 21 helt riktige modeller på holdout-delen av øvingsoppgavene
  (21 av 21 etter at én feil i fasiten ble rettet). Prompt `8f99ae83aad1`.
- **Uke 2 / Port 2:** løseren stemmer med anaStruct på alle 35 oppgaver i testsettet innenfor 1e-6
  relativt, også statisk ubestemte. Største oppgave (42 frihetsgrader) løses på 0,24 ms.
- **Neste:** uke 3, visning og interaksjon.

Referansene lages med `.venv/bin/python eval/anastruct/reference.py` etter
`python3 -m venv .venv && .venv/bin/pip install -r eval/anastruct/requirements.txt`.
