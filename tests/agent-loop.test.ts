/** Agentløkken i nettleseren med falsk transport: verktøyene kjøres mot den ekte storen, ingen nettverk. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTransport } from "../src/ui/agent/client.js";
import { appendStudentText, isNewProblem, NOTICES, replyText, useAgentStore } from "../src/ui/agent/conversation.js";
import { ABORTED_RESULT, runAgentLoop, ROUND_LIMIT_RESULT, type LoopOutcome } from "../src/ui/agent/loop.js";
import type { AgentContentBlock, AgentMessage, AgentReply, AgentToolResult } from "../src/ui/agent/protocol.js";
import { describePath, describeValue } from "../src/ui/agent/tools.js";
import { useStore } from "../src/ui/state/store.js";
import { model } from "./helpers.js";

/** Fritt opplagt bjelke 6 m med P = 12 kN midt på: reaksjoner 6 kN, M_max = 18 kNm. Begge spørres det etter. */
const beam = model({
  nodes: [
    { id: "A", x: 0, y: 0 },
    { id: "B", x: 6, y: 0 },
  ],
  members: [{ id: "AB", i: "A", j: "B", kind: "beam" }],
  supports: [
    { node: "A", type: "pinned" },
    { node: "B", type: "roller" },
  ],
  loads: [{ id: "P", type: "point", member: "AB", at: 0.5, P: 12, angle_deg: -90 }],
  asked: [{ quantity: "reaction", node: "A" }, { quantity: "M_max" }],
});

const student = (text: string): AgentMessage => ({ role: "user", content: [{ type: "text", text }] });
const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input }) as AgentContentBlock;
const text = (t: string) => ({ type: "text", text: t, citations: null }) as AgentContentBlock;

function reply(content: AgentContentBlock[], stop_reason: AgentReply["stop_reason"] = "end_turn"): AgentReply {
  return {
    content,
    stop_reason,
    stop_details: null,
    model: "claude-opus-5-5",
    usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
    costUsd: 0.001,
  };
}

type Step = (messages: AgentMessage[], handlers: Parameters<AgentTransport>[1], signal: AbortSignal) => AgentReply | Promise<AgentReply>;

/** Falsk transport: ett steg per kall (det siste gjentas). Lagrer kopier av det som ble sendt. */
function scripted(...steps: Step[]) {
  const sent: AgentMessage[][] = [];
  const transport: AgentTransport = async (messages, handlers, signal) => {
    sent.push(structuredClone(messages));
    const step = steps[Math.min(sent.length - 1, steps.length - 1)]!;
    return step(messages, handlers, signal);
  };
  return { transport, sent };
}

/** Transport som venter til den avbrytes, som fetch gjør. */
const hangs: Step = (_m, _h, signal) =>
  new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("Avbrutt", "AbortError"))));

/** Verktøyresultatene i siste brukermelding. */
function lastResults(messages: AgentMessage[]): AgentToolResult[] {
  const last = messages.at(-1)!;
  expect(last.role).toBe("user");
  return (last.content as AgentToolResult[]).filter((b) => b.type === "tool_result");
}

/** Én runde med verktøykallene, og så end_turn. Returnerer resultatene og utfallet. */
async function runTools(...calls: AgentContentBlock[]) {
  const { transport, sent } = scripted(
    () => reply(calls, "tool_use"),
    () => reply([text("Ferdig.")]),
  );
  const actions: { text: string; error: boolean }[] = [];
  const run = await runAgentLoop([student("Hei")], { transport, signal: new AbortController().signal, events: { onAction: (a) => actions.push(a) } });
  return { results: lastResults(sent[1]!), outcome: run.outcome, messages: run.messages, actions, sent };
}

beforeEach(() => {
  useAgentStore.getState().reset();
  useStore.getState().loadModel(beam);
});

describe("verktøyene mot storen", () => {
  it("get_state gir løserens tilstand, men aldri tall studenten ikke har prøvd seg på", async () => {
    const { results } = await runTools(toolUse("t1", "get_state", {}));
    const json = results[0]!.content as string;
    const state = JSON.parse(json);
    expect(results[0]!.is_error).toBeUndefined();
    expect(state.status).toBe("ok");
    expect(state.reactions).toContainEqual({ node: "A", H: "skjult", V: "skjult", M: "skjult" });
    expect(json).not.toMatch(/"V":-?6\b/);
    expect(json).not.toMatch(/"value":-?(6|18)\b/);
    expect(state.controls).toEqual([]);
    expect(state.selection).toBeNull();

    // Kontroll av testen: etter forsøk på begge spørsmålene vises tallene.
    useStore.getState().recordAttempt(0, { values: [0, 6], at: 1 });
    useStore.getState().recordAttempt(1, { values: [18], at: 1 });
    const opened = (await runTools(toolUse("t1", "get_state", {}))).results[0]!.content as string;
    expect(opened).toMatch(/"V":6\b/);
    expect(opened).toMatch(/"value":-?18\b/);
  });

  it("set_param endrer modellen med ett steg i angre-historikken; ugyldig endring gir feilmeldingen", async () => {
    const { results, actions } = await runTools(toolUse("t1", "set_param", { path: "loads.P.at", value: 0.25 }));
    expect(results[0]!.is_error).toBeUndefined();
    const s = useStore.getState();
    expect(s.model!.loads[0]).toMatchObject({ at: 0.25 });
    expect(s.past).toHaveLength(1);
    expect(actions).toEqual([{ text: "Endret posisjonen til lasten P til 25 % av lengden", error: false }]);

    const bad = await runTools(toolUse("t2", "set_param", { path: "loads.P.at", value: 1.5 }), toolUse("t3", "set_param", { path: "loads.X.P", value: 3 }));
    expect(bad.results.map((r) => r.is_error)).toEqual([true, true]);
    expect(bad.results[1]!.content).toMatch(/Fant ikke loads\.X/);
    expect(bad.actions.every((a) => a.error)).toBe(true);
    expect(useStore.getState().model!.loads[0]).toMatchObject({ at: 0.25 });
  });

  it("add_control legger til en glidebryter for en tallverdi", async () => {
    const { results, actions } = await runTools(
      toolUse("t1", "add_control", { path: "loads.P.at", label: "Lastposisjon", min: 0, max: 1, step: 0.05 }),
      toolUse("t2", "add_control", { path: "supports.B.type", label: "Opplager", min: 0, max: 1, step: 1 }),
      toolUse("t3", "add_control", { path: "loads.P.P", label: "Last", min: 10, max: 5, step: 1 }),
    );
    expect(results.map((r) => !!r.is_error)).toEqual([false, true, true]);
    expect(useStore.getState().controls).toEqual([{ path: "loads.P.at", label: "Lastposisjon", min: 0, max: 1, step: 0.05 }]);
    expect(actions[0]).toEqual({ text: "La til en glidebryter: Lastposisjon", error: false });
  });

  it("highlight uthever entiteter (opplager med node-id) og et punkt i et diagram", async () => {
    const { results, actions } = await runTools(
      toolUse("t1", "highlight", {
        targets: [
          { kind: "support", id: "A" },
          { kind: "load", id: "P" },
        ],
        diagram_point: { member: "AB", quantity: "M", at: 0.5 },
      }),
    );
    expect(results[0]!.is_error).toBeUndefined();
    const s = useStore.getState();
    expect(s.highlights).toEqual([
      { kind: "support", id: "A" },
      { kind: "load", id: "P" },
    ]);
    expect(s.diagramHighlight).toEqual({ member: "AB", quantity: "M", at: 0.5 });
    expect(actions[0]!.text).toBe("Uthevet opplageret i A, lasten P og M-diagrammet i AB ved 50 %");

    const unknown = await runTools(toolUse("t2", "highlight", { targets: [{ kind: "support", id: "B" }, { kind: "node", id: "Q" }], diagram_point: null }));
    expect(unknown.results[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/Fant ikke node Q/) });
    expect(useStore.getState().highlights).toHaveLength(2);

    const cleared = await runTools(toolUse("t3", "highlight", { targets: [], diagram_point: null }));
    expect(cleared.actions[0]!.text).toBe("Fjernet uthevingen");
    expect(useStore.getState().highlights).toEqual([]);
    expect(useStore.getState().diagramHighlight).toBeNull();
  });

  it("ask_prediction venter til studenten svarer med answerPrediction", async () => {
    const { transport, sent } = scripted(
      () => reply([toolUse("t1", "ask_prediction", { question: "Hva skjer med M_max hvis lasten flyttes mot B?", options: ["Øker", "Minker", "Uendret"] })], "tool_use"),
      () => reply([text("Se på diagrammet.")]),
    );
    let settled = false;
    const run = runAgentLoop([student("Hei")], { transport, signal: new AbortController().signal }).then((r) => {
      settled = true;
      return r;
    });
    await vi.waitFor(() => expect(useStore.getState().prediction).not.toBeNull());
    const open = useStore.getState().prediction!;
    expect(open.options).toEqual(["Øker", "Minker", "Uendret"]);
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);
    expect(sent).toHaveLength(1);

    useStore.getState().answerPrediction(open.id, { text: "Minker", optionIndex: 1 });
    const { outcome } = await run;
    expect(outcome).toEqual({ status: "done" });
    expect(JSON.parse(lastResults(sent[1]!)[0]!.content as string)).toEqual({ answer: "Minker", option_index: 1 });
  });

  it("«Vet ikke» (uten optionIndex) er et gyldig svar", async () => {
    const { transport, sent } = scripted(
      () => reply([toolUse("t1", "ask_prediction", { question: "Hvor er momentet størst?", options: ["I A", "Midt på"] })], "tool_use"),
      () => reply([text("Greit, vi ser på det sammen.")]),
    );
    const run = runAgentLoop([student("Hei")], { transport, signal: new AbortController().signal });
    await vi.waitFor(() => expect(useStore.getState().prediction).not.toBeNull());
    useStore.getState().answerPrediction(useStore.getState().prediction!.id, { text: "Vet ikke" });
    expect((await run).outcome).toEqual({ status: "done" });
    const result = lastResults(sent[1]!)[0]!;
    expect(result.is_error).toBeUndefined();
    expect(JSON.parse(result.content as string)).toEqual({ answer: "Vet ikke" });
  });

  it("ask_prediction med feil antall alternativer gir is_error uten å spørre", async () => {
    const { results } = await runTools(toolUse("t1", "ask_prediction", { question: "?", options: ["Bare ett"] }));
    expect(results[0]!.is_error).toBe(true);
    expect(useStore.getState().prediction).toBeNull();
  });
});

describe("ugyldige kall", () => {
  it("ugyldig input og ukjente verktøy gir is_error, og alle resultatene går i én melding i samme rekkefølge", async () => {
    const { results, sent } = await runTools(
      toolUse("a", "set_param", { path: "loads.P.at" }),
      toolUse("b", "get_state", { hemmelig: true }),
      toolUse("c", "solve_for_me", {}),
      toolUse("d", "highlight", { targets: [{ kind: "planet", id: "A" }], diagram_point: null }),
      toolUse("e", "get_state", {}),
    );
    expect(results.map((r) => r.tool_use_id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(results.map((r) => !!r.is_error)).toEqual([true, true, true, true, false]);
    expect(results[0]!.content).toMatch(/Ugyldig input til set_param/);
    expect(results[2]!.content).toMatch(/Ukjent verktøy «solve_for_me»/);
    // Én brukermelding med bare verktøyresultater.
    expect(sent[1]!.at(-1)!.content).toHaveLength(5);
    expect(useStore.getState().past).toHaveLength(0);
  });
});

describe("løkken", () => {
  it("stopper ved end_turn og legger svarene inn uendret (append-only)", async () => {
    const first = reply([{ type: "thinking", thinking: "", signature: "s1" } as AgentContentBlock, text("Jeg ser."), toolUse("t1", "get_state", {})], "tool_use");
    const second = reply([text("Momentet er størst midt på.")]);
    const { transport, sent } = scripted(
      () => first,
      () => second,
    );
    const initial = [student("Forklar M-diagrammet")];
    const { outcome, messages } = await runAgentLoop(initial, { transport, signal: new AbortController().signal });
    expect(outcome).toEqual({ status: "done" });
    expect(sent).toHaveLength(2);
    expect(messages).toHaveLength(4);
    expect(messages[0]).toBe(initial[0]);
    expect(messages[1]).toEqual({ role: "assistant", content: first.content });
    expect((messages[1]!.content as unknown[])[0]).toBe(first.content[0]);
    expect(messages[3]).toEqual({ role: "assistant", content: second.content });
    // Det som ble sendt andre gang, begynner med nøyaktig det som ble sendt første gang.
    expect(sent[1]!.slice(0, sent[0]!.length)).toEqual(sent[0]);
  });

  it("har et tak på antall runder per melding", async () => {
    const { transport, sent } = scripted(() => reply([toolUse(`t${Math.random()}`, "get_state", {})], "tool_use"));
    const { outcome, messages } = await runAgentLoop([student("Hei")], { transport, signal: new AbortController().signal, maxRounds: 3 });
    expect(outcome).toEqual({ status: "round_limit" });
    expect(sent).toHaveLength(3);
    // Siste kall ble ikke kjørt, men fikk et svar, så samtalen kan fortsette.
    expect(lastResults(messages)[0]).toMatchObject({ is_error: true, content: ROUND_LIMIT_RESULT });
  });

  it("avslag og kuttede svar forkastes", async () => {
    for (const stop of ["refusal", "max_tokens"] as const) {
      const { transport } = scripted(() => reply([text("Delvis"), toolUse("t1", "set_param", { path: "loads.P.at", value: 0.1 })], stop));
      const initial = [student("Hei")];
      const { outcome, messages } = await runAgentLoop(initial, { transport, signal: new AbortController().signal });
      expect(outcome).toEqual({ status: stop });
      expect(messages).toBe(initial);
      expect(useStore.getState().model!.loads[0]).toMatchObject({ at: 0.5 });
    }
  });

  it("feil fra transporten gir utfallet error med meldingen", async () => {
    const { transport } = scripted(() => {
      throw new Error("Veilederen har for mange samtaler akkurat nå.");
    });
    const { outcome } = await runAgentLoop([student("Hei")], { transport, signal: new AbortController().signal });
    expect(outcome).toEqual({ status: "error", message: "Veilederen har for mange samtaler akkurat nå." });
  });
});

describe("avbrudd", () => {
  it("under strømmen: ingenting legges til samtalen", async () => {
    const { transport } = scripted(hangs);
    const ctrl = new AbortController();
    const initial = [student("Hei")];
    const run = runAgentLoop(initial, { transport, signal: ctrl.signal });
    ctrl.abort();
    const { outcome, messages } = await run;
    expect(outcome).toEqual({ status: "aborted" });
    expect(messages).toBe(initial);
  });

  it("mens en spådom venter: spørsmålet lukkes, og alle kall i svaret får et resultat", async () => {
    const { transport, sent } = scripted(() =>
      reply(
        [
          toolUse("t1", "set_param", { path: "loads.P.at", value: 0.25 }),
          toolUse("t2", "ask_prediction", { question: "Hva skjer?", options: [] }),
          toolUse("t3", "get_state", {}),
        ],
        "tool_use",
      ),
    );
    const ctrl = new AbortController();
    const run = runAgentLoop([student("Hei")], { transport, signal: ctrl.signal });
    await vi.waitFor(() => expect(useStore.getState().prediction).not.toBeNull());
    ctrl.abort();
    const { outcome, messages } = await run;
    expect(outcome).toEqual({ status: "aborted" });
    expect(sent).toHaveLength(1);
    expect(useStore.getState().prediction).toBeNull();
    const results = lastResults(messages);
    expect(results.map((r) => [r.tool_use_id, !!r.is_error])).toEqual([
      ["t1", false],
      ["t2", true],
      ["t3", true],
    ]);
    expect(results[2]!.content).toBe(ABORTED_RESULT);
    // Endringen som rakk å bli gjort, står (studenten kan angre).
    expect(useStore.getState().model!.loads[0]).toMatchObject({ at: 0.25 });
  });
});

describe("samtalen (useAgentStore)", () => {
  const send = (t: string): Promise<LoopOutcome | undefined> => useAgentStore.getState().send(t);

  it("viser studentens melding, veilederens tekst fortløpende og handlinger", async () => {
    const deltas: string[][] = [];
    const { transport } = scripted(
      (_m, h) => {
        h.onText?.("Jeg uthever ");
        h.onText?.("maksimum.");
        deltas.push(useAgentStore.getState().entries.map((e) => e.kind));
        return reply(
          [text("Jeg uthever maksimum."), toolUse("t1", "highlight", { targets: [], diagram_point: { member: "AB", quantity: "M", at: 0.5 } })],
          "tool_use",
        );
      },
      (_m, h) => {
        h.onText?.("Her er momentet størst.");
        return reply([text("Her er momentet størst.")]);
      },
    );
    useAgentStore.setState({ transport });
    expect(await send("  Forklar M-diagrammet ")).toEqual({ status: "done" });
    const s = useAgentStore.getState();
    expect(deltas[0]).toEqual(["student", "tutor"]);
    expect(s.entries.map((e) => [e.kind, "text" in e ? e.text : ""])).toEqual([
      ["student", "Forklar M-diagrammet"],
      ["tutor", "Jeg uthever maksimum."],
      ["action", "Uthevet M-diagrammet i AB ved 50 %"],
      ["tutor", "Her er momentet størst."],
    ]);
    expect(s.entries.every((e) => e.kind !== "tutor" || !e.streaming)).toBe(true);
    expect(s.history).toHaveLength(4);
    expect(s.activity).toBeNull();
    expect(s.costUsd).toBeCloseTo(0.002);
  });

  it("restart forkaster teksten så langt i svaret", async () => {
    const { transport } = scripted((_m, h) => {
      h.onText?.("Feil tekst");
      h.onRestart?.();
      h.onText?.("Riktig tekst");
      return reply([text("Riktig tekst")]);
    });
    useAgentStore.setState({ transport });
    await send("Hei");
    expect(useAgentStore.getState().entries.filter((e) => e.kind === "tutor").map((e) => e.text)).toEqual(["Riktig tekst"]);
  });

  it("avbryt-knappen stopper strømmen; teksten blir stående merket, og neste melding legges i samme brukertur", async () => {
    const { transport, sent } = scripted((_m, h, signal) => {
      h.onText?.("Halvferdig");
      return hangs(_m, h, signal);
    }, () => reply([text("Svar.")]));
    useAgentStore.setState({ transport });
    const run = send("Første");
    await vi.waitFor(() => expect(useAgentStore.getState().activity).toBe("writing"));
    useAgentStore.getState().abort();
    expect(await run).toEqual({ status: "aborted" });
    const s = useAgentStore.getState();
    expect(s.entries.find((e) => e.kind === "tutor")).toMatchObject({ text: "Halvferdig", streaming: false, cut: "aborted" });
    expect(s.entries.at(-1)).toMatchObject({ kind: "notice", text: NOTICES.aborted });
    expect(s.activity).toBeNull();

    await send("Andre");
    expect(sent[1]).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Første" },
          { type: "text", text: "Andre" },
        ],
      },
    ]);
  });

  it("avslag fjerner den delvise teksten og viser en melding", async () => {
    const { transport } = scripted((_m, h) => {
      h.onText?.("Noe som ");
      return reply([text("Noe som ")], "refusal");
    });
    useAgentStore.setState({ transport });
    await send("Hei");
    const s = useAgentStore.getState();
    expect(s.entries.map((e) => e.kind)).toEqual(["student", "notice"]);
    expect(s.entries[1]).toMatchObject({ text: NOTICES.refusal, tone: "error" });
    expect(s.history).toHaveLength(1);
  });

  it("nullstilles når en ny oppgave lastes inn, ikke når modellen endres", async () => {
    const { transport } = scripted(() => reply([text("Ok.")]));
    useAgentStore.setState({ transport });
    await send("Hei");
    expect(useAgentStore.getState().entries).toHaveLength(2);

    useStore.getState().edit({ path: "loads.P.at", value: 0.3 });
    useStore.getState().undo();
    useStore.getState().redo();
    useStore.getState().beginGesture();
    useStore.getState().updateGesture({ path: "loads.P.at", value: 0.4 });
    useStore.getState().endGesture();
    expect(useAgentStore.getState().entries).toHaveLength(2);

    useStore.getState().loadModel({ ...beam });
    expect(useAgentStore.getState().entries).toEqual([]);
    expect(useAgentStore.getState().history).toEqual([]);

    await send("Hei igjen");
    useStore.getState().reset();
    expect(useAgentStore.getState().history).toEqual([]);
  });

  it("en ny oppgave midt i et svar avbryter, og den gamle løkken skriver ikke inn i den nye samtalen", async () => {
    const { transport } = scripted((_m, h, signal) => {
      h.onText?.("Gammel");
      return hangs(_m, h, signal);
    });
    useAgentStore.setState({ transport });
    const run = send("Hei");
    await vi.waitFor(() => expect(useAgentStore.getState().activity).toBe("writing"));
    useStore.getState().loadModel({ ...beam });
    expect(await run).toEqual({ status: "aborted" });
    expect(useAgentStore.getState().entries).toEqual([]);
    expect(useAgentStore.getState().activity).toBeNull();
  });

  it("ignorerer tomme meldinger og nye meldinger mens veilederen arbeider", async () => {
    const { transport, sent } = scripted(hangs);
    useAgentStore.setState({ transport });
    expect(await send("   ")).toBeUndefined();
    const run = send("Hei");
    expect(await send("Hei igjen")).toBeUndefined();
    useAgentStore.getState().abort();
    await run;
    expect(sent).toHaveLength(1);
  });
});

describe("hjelpefunksjoner", () => {
  it("appendStudentText legger teksten i en ubesvart brukermelding, ellers i en ny", () => {
    const answered: AgentMessage[] = [student("A"), { role: "assistant", content: [text("B")] }];
    expect(appendStudentText(answered, "C")).toEqual([...answered, student("C")]);
    const pending: AgentMessage[] = [...answered, { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "x" }] }];
    expect(appendStudentText(pending, "C").at(-1)).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t", content: "x" },
        { type: "text", text: "C" },
      ],
    });
    expect(appendStudentText(pending, "C")[1]).toBe(answered[1]);
  });

  it("isNewProblem skiller ny oppgave fra endringer", () => {
    const before = useStore.getState();
    useStore.getState().edit({ path: "loads.P.at", value: 0.2 });
    expect(isNewProblem(useStore.getState(), before)).toBe(false);
    const edited = useStore.getState();
    useStore.getState().loadModel(beam);
    expect(isNewProblem(useStore.getState(), edited)).toBe(true);
  });

  it("replyText: avsnitt mellom tekst rundt verktøykall, men ikke over en fallback-grense", () => {
    const fallback = { type: "fallback", from: { model: "a" }, to: { model: "b" }, trigger: null } as unknown as AgentContentBlock;
    expect(replyText([text("Først."), toolUse("t", "get_state", {}), text("Så.")])).toBe("Først.\n\nSå.");
    expect(replyText([text("Halv "), fallback, text("setning.")])).toBe("Halv setning.");
    expect(replyText([{ type: "thinking", thinking: "", signature: "s" } as AgentContentBlock, toolUse("t", "get_state", {})])).toBe("");
  });

  it("stier og verdier på norsk", () => {
    expect(describePath("loads.P1.at")).toBe("posisjonen til lasten P1");
    expect(describePath("supports.B.type")).toBe("opplageret i B");
    expect(describePath("nodes.B.x")).toBe("x-koordinaten til node B");
    expect(describeValue("supports.B.type", "roller", beam)).toBe("rullelager");
    expect(describeValue("loads.P.P", 7.5, beam)).toBe("7,5 kN");
    expect(describeValue("loads.P.angle_deg", -90, beam)).toBe("-90°");
  });
});
