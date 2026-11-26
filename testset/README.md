# Testsettet

30 oppgaver fra gamle eksamener og øvinger: 10 bjelker, 10 rammer og 10 fagverk. Testsettet brukes
bare internt (opphavsrett), og det avgjør Port 1.

## Status

Mappene `ov*` er hentet fra øvingene i TKT4116 Mekanikk 1 V2026. Hver mappe har øvings-PDF-en,
`meta.json` (side, kilde, svarantydning og kontroll i `notes`), `problem.txt` og `truth.json`.

- **`"split": "tuning"`** (10 oppgaver): prompten justeres på disse.
- **`"split": "holdout"`** (21 oppgaver): brukes bare til å måle Port 1. Øving 4 oppgave 5 er tatt ut fordi
  buen er krum, og det er utenfor v1.
- Fasitmodellene er skrevet av Claude ut fra oppgaven og løsningsforslaget, og regnet gjennom med anaStruct
  mot svarantydningen og diagramverdiene på siden. `notes` sier hva hver modell er kontrollert mot.
- Der figuren ikke skiller fastlager fra rullelager og svaret ikke avhenger av det, er kurskonvensjonen
  (fastlager til venstre) brukt. Det slo feil én gang (ov06-2b, rettet etter løsningsforslaget), så
  ov09-2 og ov12-3 bør sjekkes mot løsningsforslaget.
- Holdout-delen har bare ett fagverk, og øvingssidene har svarantydning som hjelper tolkningen. Legg til
  eksamensoppgaver (særlig fagverk) for en strengere måling.

**Kursmateriale committes ikke så lenge repoet er offentlig.** `.gitignore` holder alt i `testset/` utenfor
git bortsett fra denne filen og eksemplene `ex-*`. Fjern de linjene når repoet er privat.

## Én mappe per oppgave

```
testset/
  bjelke-01/
    meta.json      kategori og kilde
    truth.json     fasitmodellen
    figure.png     figuren slik studenten ville lastet den opp (png, jpg, webp eller gif)
    oppgave.pdf    eller hele eksamenssiden som PDF (alle .pdf-filer i mappen brukes)
    problem.txt    oppgaveteksten (valgfri, hvis den ikke står i figuren)
```

Flere figurer: `figure-1.png`, `figure-2.png` osv. En PDF rendres til bilder på samme måte som i
appen, med så høy oppløsning som Claude tar imot. Står det flere oppgaver på siden, skriv f.eks.
«Løs oppgave 2.» i `problem.txt`, slik en student ville gjort. Velg sider med `"pages": [2]` i meta.json. Mappenavnet er oppgavens id. Mapper som begynner
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
- **Tverrsnitt:** bare hvis E, A og I står som tall i oppgaven, med `assumed: false`. Er tverrsnittet bare
  gitt som mål (f.eks. rør 160 × 5 mm) eller profilnavn (IPE300), utelates det, siden LLM-en ikke skal regne.
- **Symbolske oppgaver** (F, q, L, a i stedet for tall): sett hvert grunnsymbol til 1 i m og kN
  (L = a = H = 1 m, F = 1 kN, q = 1 kN/m, M0 = 1 kNm), og skriv resten som multipler: 0,25L → 0.25,
  2F → `P: 2`, 4a → 4. En last som er definert fra andre symboler, er et multiplum: F = qL → `P: 1`,
  F = 3qH → `P: 3`. Tall som står i oppgaven, beholdes (geometri i a med P = 100 kN gir a = 1 m og `P: 100`).
  List grunnsymbolene i `symbols`, f.eks. `[{ "name": "q", "kind": "distributed" }, { "name": "a", "kind": "length" }]`.
  `notes` i meta.json sier hvilke oppgaver som er symbolske.
- **`asked`:** hva oppgaven spør etter (`reaction`, `member_force`, `diagrams`, `M_max` ...).
- `provenance` og `questions` brukes ikke i fasiten.

Det spiller ingen rolle om en punktlast står i en egen node eller på elementet, om elementene går
A→B eller B→A, eller hvilken ende av et ledd som har `release`. Sammenligningen (`src/core/compare.ts`)
regner slike skrivemåter som like.

## Sjekk og kjøring

```
pnpm testset:check                  sjekker at alle fasitmodellene er gyldige (kjøres også i CI)
pnpm pdf:render oppgave.pdf         lagrer sidene som PNG, så du ser hva tolkningen får
pnpm eval:interpret --dry-run       viser hvilke oppgaver som blir kjørt
pnpm eval:interpret                 kjører tolkningen mot alle 30 (koster penger)
pnpm eval:interpret --only bjelke-01
```

Resultatet lagres i `eval/results/` som markdown (oversikt) og JSON (alle detaljer, også den tolkede modellen).
