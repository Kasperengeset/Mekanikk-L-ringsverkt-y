# Uke 3: visning og interaksjon – arbeidsdeling

Fundamentet (denne grenen) definerer grensesnittene. Tre spor bygger parallelt, hvert i sin egen gren.

## Eierskap

| Del | Filer | Merknad |
|---|---|---|
| Fundament | `src/core/**`, `src/ui/App.tsx`, `src/ui/state/**`, `src/ui/geometry.ts`, `src/ui/convention.ts`, `src/ui/format.ts`, `src/ui/types.ts`, `src/ui/fixtures.ts`, `src/ui/styles.css`, `src/ui/panel/**`, `scripts/**`, `package.json` | Endres ikke av sporene. Er det helt nødvendig, hold endringen minimal og nevn den i rapporten. |
| A – konstruksjon og interaksjon | `src/ui/structure/**`, `src/core/edit-ops.ts` (ny), `tests/edit-ops.test.ts`, `tests/structure*.test.ts(x)` | |
| B – diagrammer og deformert form | `src/ui/diagrams/**`, `tests/diagrams*.test.ts(x)` | |
| C – opplasting og tolkning | `api/**`, `server/**`, `src/ui/upload/**`, `src/ui/api/**`, `vite.config.ts`, `public/**`, `tests/upload*.test.ts(x)`, `tests/api*.test.ts` | |

## Grensesnitt

- **Modell:** `src/core/schema.ts`. Endringer går gjennom `src/core/edit.ts` (`setParam(model, "loads.P1.at", 0.4)`),
  og i appen gjennom storen: `edit()` for klikk og glidebrytere, `beginGesture()` / `updateGesture()` / `endGesture()`
  for dra. `updateGesture` tar også en hel modell når topologien endres (f.eks. når to elementer slås sammen).
- **Løsning:** `useSolveResult()` gir `SolveResult` (SI-enheter). Snittkrefter som polynomer i `member.pieces`,
  deformert form i `member.deflection`, `displacedPoint(member, x, scale)` for tegning.
- **Tegning:** komponentene får `CanvasProps = { model, result, viewport }` og har `<svg>` som rot, så de kan rendres
  uten nettleser. `viewport.toScreen` (modellenheter), `viewport.siToScreen` (SI fra løseren).
  Diagrammene bruker konstruksjonens skala og venstrekant: `fitViewport(model, w, h, { scale, originX })`.
- **Fortegn:** `src/ui/convention.ts`. M på strekksiden (`positiveSide("M", cos, sin)`), N og V med virkningssymbol.
- **Tekst:** `formatQuantity(kind, verdiSI, model)` gir oppgavens enheter, eller symboler (0,113 FL) i symbolske oppgaver.
- **Usikre entiteter:** `model.provenance` med `confidence < 0.7`, og `store.highlights` (EntityRef `{ kind, id }`,
  opplager adresseres med node-id).
- **Faser:** `store.phase` er `upload` → `confirm` → `explore`.

## Verktøy

- `pnpm dev` og åpne `/?eksempel=gerber` (se `src/ui/fixtures.ts` for navn).
- `pnpm snapshot --component src/ui/structure/StructureSvg.tsx#StructureSvg --fixture treledd` gir en PNG i
  `eval/results/snapshots/` som kan åpnes og sjekkes visuelt.
- `pnpm typecheck && pnpm lint && pnpm test` skal være grønt før et spor er ferdig.

## Konvensjoner

Koden på engelsk, kommentarer og all tekst i appen på norsk bokmål. Små commits med norske meldinger.
Ingen nye avhengigheter uten god grunn. Ingen kall mot det ekte Claude-API-et i tester.
