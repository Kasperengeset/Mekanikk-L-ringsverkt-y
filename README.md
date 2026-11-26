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
| `src/core/llm/` | Prompter og verktøydefinisjoner. |
| `server/llm/` | Adapterlaget mot LLM-leverandøren (`claude.ts`) og pristabell. |
| `server/interpret.ts` | Tolkningsløpet med valgfri self-consistency. |
| `eval/` | Eval-skriptet for tolkningen og innlesing av testsettet. |
| `testset/` | Oppgaver med fasitmodeller. Se `testset/README.md`. |
| `src/ui/` | Frontend (uke 3). |

## Status

Uke 1: skjema, validering, sammenligning, tolkning med Claude og eval-skript er på plass.
Testsettet (30 oppgaver) gjenstår.
