# Testsettet

30 oppgaver fra gamle eksamener og øvinger: 10 bjelker, 10 rammer og 10 fagverk. Testsettet brukes
bare internt (opphavsrett), og det avgjør Port 1.

## Én mappe per oppgave

```
testset/
  bjelke-01/
    meta.json      kategori og kilde
    truth.json     fasitmodellen
    figure.png     figuren slik studenten ville lastet den opp (png, jpg, webp eller gif)
    problem.txt    oppgaveteksten (valgfri, hvis den ikke står i figuren)
```

Flere figurer: `figure-1.png`, `figure-2.png` osv. Mappenavnet er oppgavens id. Mapper som begynner
med `ex-` er eksempler (`"example": true` i meta.json) og teller ikke i testsettet.

`meta.json`:

```json
{ "category": "beam", "source": "TKT4116 eksamen V2024, oppgave 2", "notes": "valgfritt" }
```

`category` er `beam`, `frame` eller `truss`.

## Slik skrives fasitmodellen

Skjemaet er definert i `src/core/schema.ts`. Se eksemplene i `ex-*`-mappene. Det viktigste:

- **Enheter:** `units` er oppgavens enheter. Koordinater og laster skrives i dem, tverrsnitt (E, A, I) alltid i SI.
- **Koordinater:** x mot høyre, y oppover. Origo kan ligge hvor som helst.
- **Elementer:** `kind: "beam"` for bjelker og rammer, `"truss"` for fagverksstaver. Indre ledd skrives som
  `release: { "i": false, "j": true }` på én av elementendene i leddet.
- **Opplagre:** `fixed` (fast innspenning), `pinned` (fastlager), `roller` (rullelager, `angle_deg` = helningen på underlaget).
- **Punktlast:** `P` (størrelse) og `angle_deg` (retningen pilen peker, mot klokka fra +x: nedover = -90).
  Står i en node (`node`) eller på et element (`member` + `at`, andel av lengden fra i-enden).
- **Moment:** `M`, positivt mot klokka.
- **Fordelt last:** `w_start`/`w_end` per lengde, med fortegn langs `direction` (`global_y`: nedover er negativ).
  `basis: "projection"` for last per horisontal lengde på skrå elementer (snø), ellers `"length"`.
- **Tverrsnitt:** bare hvis oppgaven oppgir dem, med `assumed: false`.
- **`asked`:** hva oppgaven spør etter (`reaction`, `member_force`, `diagrams`, `M_max` ...).
- `provenance` og `questions` brukes ikke i fasiten.

Det spiller ingen rolle om en punktlast står i en egen node eller på elementet, om elementene går
A→B eller B→A, eller hvilken ende av et ledd som har `release`. Sammenligningen (`src/core/compare.ts`)
regner slike skrivemåter som like.

## Sjekk og kjøring

```
pnpm testset:check                  sjekker at alle fasitmodellene er gyldige (kjøres også i CI)
pnpm eval:interpret --dry-run       viser hvilke oppgaver som blir kjørt
pnpm eval:interpret                 kjører tolkningen mot alle 30 (koster penger)
pnpm eval:interpret --only bjelke-01
```

Resultatet lagres i `eval/results/` som markdown (oversikt) og JSON (alle detaljer, også den tolkede modellen).
