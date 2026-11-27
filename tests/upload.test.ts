/** Opplasting og bekreftelsessteget: ren logikk og flyten mot storen (node-miljø, ingen ekte API-kall). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getParam } from "../src/core/edit.js";
import type { Model, Provenance } from "../src/core/schema.js";
import { CLAUDE_MAX_LONG_EDGE, CLAUDE_MAX_PIXELS } from "../src/pdf/render.js";
import { ACCESS_MISSING } from "../server/access.js";
import { clearAccessCode, submitAccessCode, useAccess } from "../src/ui/api/access.js";
import { ACCESS_HEADER, base64DecodedSize } from "../src/ui/api/protocol.js";
import { FIXTURES } from "../src/ui/fixtures.js";
import { useStore } from "../src/ui/state/store.js";
import {
  classifyFile,
  composeText,
  defaultPages,
  fitWithinLimits,
  imageByteBudget,
  maxPagesFor,
  planImage,
  stripDataUrl,
  summarizePartial,
  togglePage,
} from "../src/ui/upload/logic.js";
import {
  entryTitle,
  formatValue,
  highlightRefs,
  parseAlternative,
  parseNumber,
  provenancePath,
  provenanceRef,
  uncertainEntries,
} from "../src/ui/upload/provenance.js";
import type { Attachment } from "../src/ui/upload/session.js";
import { createInterpretHandler } from "../server/interpretHandler.js";
import { EMPTY_USAGE } from "../server/llm/adapter.js";
import { model as buildModel } from "./helpers.js";

/** Bjelke A–C–B med fastlager, rullelager, punktlast og ledd, og usikre tolkninger. */
function uncertainBeam(provenance: Provenance[]): Model {
  return buildModel({
    nodes: [
      { id: "A", x: 0, y: 0 },
      { id: "C", x: 2, y: 0 },
      { id: "B", x: 6, y: 0 },
    ],
    members: [
      { id: "AC", i: "A", j: "C", kind: "beam" },
      { id: "CB", i: "C", j: "B", kind: "beam" },
    ],
    supports: [
      { node: "A", type: "pinned" },
      { node: "B", type: "roller", angle_deg: 0 },
    ],
    loads: [{ id: "P1", type: "point", node: "C", P: 10, angle_deg: -90 }],
    provenance,
  });
}

const prov = (p: Partial<Provenance> & Pick<Provenance, "entity_kind" | "entity">): Provenance => ({ confidence: 0.5, note: "Usikker.", ...p });

describe("provenance → sti", () => {
  const m = uncertainBeam([]);

  it("bygger stien fra entitet og felt, med opplager adressert med node-id", () => {
    expect(provenancePath(prov({ entity_kind: "support", entity: "B", field: "type" }), m)).toBe("supports.B.type");
    expect(provenancePath(prov({ entity_kind: "load", entity: "P1", field: "angle_deg" }), m)).toBe("loads.P1.angle_deg");
    expect(provenancePath(prov({ entity_kind: "node", entity: "C", field: "x" }), m)).toBe("nodes.C.x");
    expect(provenancePath(prov({ entity_kind: "member", entity: "AC", field: "release.j" }), m)).toBe("members.AC.release.j");
  });

  it("et anslått mål på en node blir nodens koordinat", () => {
    expect(provenancePath(prov({ entity_kind: "dimension", entity: "C", field: "x" }), m)).toBe("nodes.C.x");
    expect(provenancePath(prov({ entity_kind: "dimension", entity: "C", field: "lengde" }), m)).toBeNull();
    expect(provenancePath(prov({ entity_kind: "dimension", entity: "L1", field: "x" }), m)).toBeNull();
  });

  it("ingen sti uten felt, for spørsmål, for ukjente entiteter eller rare feltnavn", () => {
    expect(provenancePath(prov({ entity_kind: "support", entity: "B" }), m)).toBeNull();
    expect(provenancePath(prov({ entity_kind: "asked", entity: "A", field: "node" }), m)).toBeNull();
    expect(provenancePath(prov({ entity_kind: "load", entity: "P9", field: "P" }), m)).toBeNull();
    expect(provenancePath(prov({ entity_kind: "load", entity: "P1", field: "P; slett" }), m)).toBeNull();
  });

  it("uthever entiteten (opplager med node-id), og mål via noden eller elementet", () => {
    expect(provenanceRef(prov({ entity_kind: "support", entity: "B" }), m)).toEqual({ kind: "support", id: "B" });
    expect(provenanceRef(prov({ entity_kind: "dimension", entity: "C" }), m)).toEqual({ kind: "node", id: "C" });
    expect(provenanceRef(prov({ entity_kind: "dimension", entity: "CB" }), m)).toEqual({ kind: "member", id: "CB" });
    expect(provenanceRef(prov({ entity_kind: "asked", entity: "A" }), m)).toBeNull();
    expect(provenanceRef(prov({ entity_kind: "load", entity: "P9" }), m)).toBeNull();
  });

  it("bare usikre oppføringer (< 0,7), minst sikre først, og uthevinger uten duplikater", () => {
    const model = uncertainBeam([
      prov({ entity_kind: "load", entity: "P1", field: "P", confidence: 0.6 }),
      prov({ entity_kind: "support", entity: "B", field: "type", confidence: 0.3 }),
      prov({ entity_kind: "support", entity: "B", confidence: 0.5 }),
      prov({ entity_kind: "node", entity: "A", field: "x", confidence: 0.95 }),
      prov({ entity_kind: "node", entity: "A", field: "y", confidence: 0.7 }),
    ]);
    const entries = uncertainEntries(model);
    expect(entries.map((e) => [e.provenance.confidence, e.path])).toEqual([
      [0.3, "supports.B.type"],
      [0.5, null],
      [0.6, "loads.P1.P"],
    ]);
    expect(highlightRefs(entries)).toEqual([
      { kind: "support", id: "B" },
      { kind: "load", id: "P1" },
    ]);
  });
});

describe("alternativer", () => {
  const m = uncertainBeam([]);

  it("tall parses fra streng med desimalkomma, minus, grader og enheter", () => {
    expect(parseAlternative("-60", "loads.P1.angle_deg", m)).toEqual({ ok: true, value: -60 });
    expect(parseAlternative("−120°", "loads.P1.angle_deg", m)).toEqual({ ok: true, value: -120 });
    expect(parseAlternative("2,5 m", "nodes.C.x", m)).toEqual({ ok: true, value: 2.5 });
    expect(parseAlternative(" 12 kN ", "loads.P1.P", m)).toEqual({ ok: true, value: 12 });
    expect(parseNumber("1e3")).toBe(1000);
    expect(parseNumber(",5")).toBe(0.5);
    expect(parseAlternative("omtrent 3", "nodes.C.x", m).ok).toBe(false);
  });

  it("et tallfelt som mangler i modellen, parses også som tall", () => {
    expect(getParam(m, "supports.A.angle_deg")).toBeUndefined();
    expect(parseAlternative("30", "supports.A.angle_deg", m)).toEqual({ ok: true, value: 30 });
  });

  it("opplagertyper godtas både som skjemaverdi og på norsk", () => {
    expect(parseAlternative("pinned", "supports.B.type", m)).toEqual({ ok: true, value: "pinned" });
    expect(parseAlternative("Fastlager", "supports.B.type", m)).toEqual({ ok: true, value: "pinned" });
    expect(parseAlternative("fast innspenning", "supports.B.type", m)).toEqual({ ok: true, value: "fixed" });
    expect(parseAlternative("hengsel", "supports.B.type", m).ok).toBe(false);
  });

  it("ja/nei-felt og tekstfelt", () => {
    expect(parseAlternative("true", "members.AC.release.j", m)).toEqual({ ok: true, value: true });
    expect(parseAlternative("nei", "members.AC.release.j", m)).toEqual({ ok: true, value: false });
    expect(parseAlternative("truss", "members.AC.kind", m)).toEqual({ ok: true, value: "truss" });
  });

  it("vises på norsk med enheter", () => {
    expect(formatValue("supports.B.type", "roller", m)).toBe("rullelager");
    expect(formatValue("loads.P1.angle_deg", -90, m)).toBe("-90°");
    expect(formatValue("nodes.C.x", 2.5, m)).toBe("2,5 m");
    expect(formatValue("loads.P1.P", 10, m)).toBe("10 kN");
    expect(formatValue("members.AC.release.j", true, m)).toBe("ja");
    expect(formatValue("nodes.B.x", 1.5, FIXTURES.symbolsk!.model)).toBe("1,5");
    expect(entryTitle(prov({ entity_kind: "support", entity: "B", field: "type" }))).toBe("Opplager B – type");
    expect(entryTitle(prov({ entity_kind: "load", entity: "P1", field: "angle_deg" }))).toBe("Last P1 – vinkel");
  });

  it("et klikk endrer modellen gjennom storen, og en avvist endring gir en feilmelding", () => {
    useStore.getState().loadModel(m, "confirm");
    const parsed = parseAlternative("fastlager", "supports.B.type", m);
    expect(parsed.ok && useStore.getState().edit({ path: "supports.B.type", value: parsed.value }).ok).toBe(true);
    expect(getParam(useStore.getState().model!, "supports.B.type")).toBe("pinned");
    // En last i en node som ikke finnes, avvises av valideringen med en melding, og historikken er urørt.
    const r = useStore.getState().edit({ path: "loads.P1.node", value: "X" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    expect(useStore.getState().past).toHaveLength(1);
  });
});

describe("nedskalering", () => {
  it("skalerer ikke opp små bilder", () => {
    expect(fitWithinLimits({ width: 800, height: 600 })).toEqual({ width: 800, height: 600, scale: 1 });
  });

  it("langsiden begrenser et langt, smalt bilde", () => {
    const r = fitWithinLimits({ width: 6000, height: 500 });
    expect(r.width).toBe(CLAUDE_MAX_LONG_EDGE);
    expect(r.height).toBe(Math.floor(500 * (CLAUDE_MAX_LONG_EDGE / 6000)));
  });

  it("antall piksler begrenser et stort foto, og begge grensene holder etter avrunding", () => {
    for (const [w, h] of [
      [4032, 3024],
      [3000, 3000],
      [2576, 2000],
      [12000, 9000],
    ] as const) {
      const r = fitWithinLimits({ width: w, height: h });
      expect(r.width * r.height).toBeLessThanOrEqual(CLAUDE_MAX_PIXELS);
      expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(CLAUDE_MAX_LONG_EDGE);
      expect(r.width / r.height).toBeCloseTo(w / h, 2);
    }
    // 4032 × 3024 (12 MP): sqrt(3,75 MP / 12,19 MP) ≈ 0,5546.
    expect(fitWithinLimits({ width: 4032, height: 3024 })).toMatchObject({ width: 2236, height: 1677 });
  });

  it("bilder innenfor grensene og budsjettet sendes som de er; ellers skaleres og kodes de på nytt", () => {
    const budget = imageByteBudget(1);
    expect(planImage({ width: 1200, height: 900 }, 200_000, "image/png", budget)).toEqual({ action: "keep" });
    const big = planImage({ width: 4032, height: 3024 }, 3_000_000, "image/jpeg", budget);
    expect(big).toMatchObject({ action: "encode", width: 2236, height: 1677 });
    // Foto forblir JPEG; PNG prøves først for andre bilder.
    expect(big.action === "encode" && big.formats.every((f) => f.type === "image/jpeg")).toBe(true);
    const heavy = planImage({ width: 2000, height: 1400 }, budget + 1, "image/png", budget);
    expect(heavy).toMatchObject({ action: "encode", width: 2000, height: 1400 });
    expect(heavy.action === "encode" && heavy.formats[0]).toEqual({ type: "image/png" });
    expect(planImage({ width: 100, height: 100 }, 1000, "image/bmp", budget).action).toBe("encode");
  });

  it("budsjettet deles på bildene, så hele forespørselen holder seg under ca. 4 MB base64", () => {
    for (const n of [1, 2, 3, 4]) expect((imageByteBudget(n) * n * 4) / 3).toBeLessThanOrEqual(4.2 * 1024 * 1024);
    expect(imageByteBudget(0)).toBe(imageByteBudget(1));
  });
});

describe("sidevalg", () => {
  it("første side er valgt som standard", () => {
    expect(defaultPages(12)).toEqual([1]);
    expect(defaultPages(0)).toEqual([]);
  });

  it("klikk velger og fjerner sider, sortert, og stopper ved grensen", () => {
    expect(togglePage([1], 3, 4)).toEqual([1, 3]);
    expect(togglePage([3], 1, 4)).toEqual([1, 3]);
    expect(togglePage([1, 3], 1, 4)).toEqual([3]);
    expect(togglePage([1, 2], 3, 2)).toEqual([1, 2]);
    // En valgt side kan alltid fjernes, også over grensen.
    expect(togglePage([1, 2, 3], 2, 2)).toEqual([1, 3]);
  });

  it("antall sider som kan velges, avhenger av de andre bildene", () => {
    expect(maxPagesFor(0)).toBe(4);
    expect(maxPagesFor(3)).toBe(1);
    expect(maxPagesFor(5)).toBe(0);
  });
});

describe("tekst og filer", () => {
  it("oppgavetekst og «Hvilken oppgave?» settes sammen", () => {
    expect(composeText("", "Løs oppgave 2")).toBe("Løs oppgave 2");
    expect(composeText(" Bjelke A–B ", "")).toBe("Bjelke A–B");
    expect(composeText("Bjelke A–B", "b)")).toBe("Bjelke A–B\n\nHvilken oppgave: b)");
    expect(composeText(" ", " ")).toBeUndefined();
  });

  it("filtype fra MIME-type eller filnavn", () => {
    expect(classifyFile({ name: "Skjermbilde.PNG", type: "" })).toBe("image");
    expect(classifyFile({ name: "eksamen.pdf", type: "application/pdf" })).toBe("pdf");
    expect(classifyFile({ name: "oppgave.txt", type: "text/plain" })).toBe("text");
    expect(classifyFile({ name: "bilde.heic", type: "image/heic" })).toBe("unsupported");
  });

  it("oppsummerer en delvis modell og dekoder base64-størrelser", () => {
    expect(summarizePartial({ nodes: [{}, {}, {}], members: [{}], loads: [] })).toBe("3 noder · 1 element");
    expect(summarizePartial(null)).toBeNull();
    expect(summarizePartial({ units: {} })).toBeNull();
    expect(stripDataUrl("data:image/png;base64,iVBO")).toBe("iVBO");
    expect(base64DecodedSize(btoa("abcde"))).toBe(5);
    expect(base64DecodedSize(btoa("abcdef"))).toBe(6);
  });
});

describe("opplastingsflyten mot storen", () => {
  const model = uncertainBeam([prov({ entity_kind: "support", entity: "B", field: "type", confidence: 0.4, alternatives: ["pinned"] })]);

  beforeEach(() => {
    const handle = createInterpretHandler({
      createProvider: ({ onEvent }) => ({
        name: "falsk",
        async interpret() {
          onEvent?.({ type: "request", attempt: 1, resend: false });
          onEvent?.({ type: "text", delta: "En bjelke." });
          return {
            model,
            questions: ["Er B et rullelager?"],
            description: "En bjelke.",
            warnings: [],
            usage: EMPTY_USAGE,
            costUsd: 0,
            latencyMs: 1,
            attempts: 1,
            retryReasons: [],
            servedBy: "falsk",
          };
        },
      }),
      interpretOptions: { consistency: "never" },
    });
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => handle(new Request(new URL(String(input), "http://localhost"), init)));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("tekst alene gir modell i bekreftelsessteget, og «Last opp på nytt» går tilbake med teksten intakt", async () => {
    const session = await import("../src/ui/upload/session.js");
    session.setProblemText("Bjelke A–B på 6 m.");
    session.setWhich("Løs oppgave 2");
    await session.startInterpretation();

    const s = useStore.getState();
    expect(s.phase).toBe("confirm");
    expect(s.model).toEqual(model);
    expect(s.interpretation).toMatchObject({ status: "done", description: "En bjelke.", questions: ["Er B et rullelager?"] });
    expect(session.useUploadSession.getState()).toMatchObject({ busy: false, progress: null });

    session.resetToUpload();
    expect(useStore.getState()).toMatchObject({ phase: "upload", model: null, highlights: [] });
    expect(useStore.getState().interpretation.status).toBe("idle");
    expect(session.useUploadSession.getState()).toMatchObject({ problemText: "Bjelke A–B på 6 m.", which: "Løs oppgave 2" });
  });

  it("uten tilgangskode bes det om koden, og tolkningen kjøres på nytt med den", async () => {
    const session = await import("../src/ui/upload/session.js");
    const inner = globalThis.fetch;
    const sent: (string | null)[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const code = new Headers(init?.headers).get(ACCESS_HEADER);
      sent.push(code);
      return code === "ola-7f3k" ? inner(input, init) : Promise.resolve(Response.json({ error: { code: "access", message: ACCESS_MISSING } }, { status: 401 }));
    });
    session.setProblemText("Bjelke A–B på 6 m.");
    await session.startInterpretation();
    expect(useStore.getState().interpretation).toMatchObject({ status: "error", error: ACCESS_MISSING });
    expect(useAccess.getState().message).toBe(ACCESS_MISSING);

    submitAccessCode("ola-7f3k");
    await vi.waitFor(() => expect(useStore.getState().phase).toBe("confirm"));
    expect(sent).toEqual([null, "ola-7f3k"]);
    clearAccessCode();
    session.resetToUpload();
  });

  it("uten bilde og uten oppgavetekst sendes ingenting", async () => {
    const session = await import("../src/ui/upload/session.js");
    session.setProblemText("");
    session.setWhich("Løs oppgave 2");
    await session.startInterpretation();
    expect(session.useUploadSession.getState().notice).toMatch(/Last opp et bilde/);
    expect(useStore.getState().phase).toBe("upload");
  });

  it("sidevalg i en PDF respekterer grensen på fire bilder", async () => {
    const session = await import("../src/ui/upload/session.js");
    const pdf = (id: string, selected: number[]): Attachment => ({
      id,
      kind: "pdf",
      name: `${id}.pdf`,
      data: new Uint8Array(),
      status: "ready",
      numPages: 6,
      thumbnails: [],
      selected,
    });
    session.useUploadSession.setState({ attachments: [pdf("a", [1, 2]), pdf("b", [1])], notice: null });
    session.togglePdfPage("b", 2);
    expect(session.imageCount(session.useUploadSession.getState().attachments)).toBe(4);
    session.togglePdfPage("b", 3);
    expect(session.useUploadSession.getState().notice).toMatch(/Høyst 4 bilder/);
    expect(session.imageCount(session.useUploadSession.getState().attachments)).toBe(4);
    session.togglePdfPage("a", 1);
    expect(session.useUploadSession.getState().attachments.find((a) => a.id === "a")).toMatchObject({ selected: [2] });
    session.useUploadSession.setState({ attachments: [] });
  });
});
