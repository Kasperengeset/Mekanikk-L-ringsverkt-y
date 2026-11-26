/** /api/interpret med falske leverandører – ingen kall mot det ekte Claude-API-et. */
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { createInterpretHandler, type InterpretHandlerDeps, type ProviderOptions } from "../server/interpretHandler";
import { EMPTY_USAGE, InterpretError, type InterpretInput, type InterpretResult, type InterpretStreamEvent } from "../server/llm/adapter";
import { ClaudeProvider } from "../server/llm/claude";
import type { Model } from "../src/core/schema";
import type { ServerEvent } from "../src/ui/api/protocol";
import { createSseParser, encodeSseEvent } from "../src/ui/api/sse";
import { simpleBeam } from "./helpers";

const PNG = { mediaType: "image/png", data: "iVBORw0KGgo=" };

function result(model: Model, extra: Partial<InterpretResult> = {}): InterpretResult {
  return {
    model,
    questions: [],
    description: "En bjelke.",
    warnings: [],
    usage: { ...EMPTY_USAGE, inputTokens: 100, outputTokens: 50 },
    costUsd: 0.01,
    latencyMs: 10,
    attempts: 1,
    retryReasons: [],
    servedBy: "falsk",
    ...extra,
  };
}

/** Falsk leverandør: kjører skriptet (strømhendelser) og returnerer eller kaster. */
function fakeDeps(
  script: (emit: (e: InterpretStreamEvent) => void, input: InterpretInput, call: number) => Promise<InterpretResult>,
  extra: Partial<InterpretHandlerDeps> = {},
) {
  const created: ProviderOptions[] = [];
  const inputs: InterpretInput[] = [];
  let calls = 0;
  const deps: InterpretHandlerDeps = {
    createProvider(options) {
      created.push(options);
      return {
        name: "falsk",
        interpret: (input) => {
          inputs.push(input);
          return script((e) => options.onEvent?.(e), input, ++calls);
        },
      };
    },
    partialIntervalMs: 0,
    log: () => {},
    ...extra,
  };
  return { deps, created, inputs };
}

const post = (body: unknown, init: RequestInit = {}) =>
  new Request("http://localhost/api/interpret", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });

async function events(res: Response): Promise<ServerEvent[]> {
  const out: ServerEvent[] = [];
  const parser = createSseParser((m) => out.push({ event: m.event, data: JSON.parse(m.data) } as ServerEvent));
  parser.push(await res.text());
  parser.end();
  return out;
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("validering", () => {
  const { deps } = fakeDeps(async () => result(simpleBeam()));
  const handle = createInterpretHandler(deps);

  it("avviser for mange bilder", async () => {
    const res = await handle(post({ images: Array(5).fill(PNG) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "bad_request", message: "Høyst 4 bilder per tolkning." } });
  });

  it("avviser feil mediatype", async () => {
    const res = await handle(post({ images: [{ mediaType: "image/bmp", data: "AAAA" }] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/PNG, JPEG, WebP eller GIF/);
  });

  it("avviser ugyldig base64, ugyldig JSON og tom forespørsel", async () => {
    expect((await handle(post({ images: [{ mediaType: "image/png", data: "ikke base64!" }] }))).status).toBe(400);
    expect((await handle(post("{ikke json"))).status).toBe(400);
    const empty = await handle(post({ images: [], text: "  " }));
    expect(empty.status).toBe(400);
    expect((await empty.json()).error.message).toMatch(/Last opp et bilde/);
  });

  it("avviser for store bilder, ett og ett og til sammen", async () => {
    const mb = (n: number) => ({ mediaType: "image/jpeg", data: "A".repeat(Math.ceil((n * 1024 * 1024 * 4) / 3)) });
    const single = await handle(post({ images: [mb(6)] }));
    expect(single.status).toBe(400);
    expect((await single.json()).error.message).toMatch(/større enn 5 MB/);
    const total = await handle(post({ images: [mb(4), mb(4), mb(4)] }));
    expect(total.status).toBe(413);
    expect((await total.json()).error.code).toBe("too_large");
  });

  it("avviser for stor forespørsel før kroppen leses", async () => {
    const res = await handle(post({ text: "x" }, { headers: { "content-length": String(50 * 1024 * 1024) } }));
    expect(res.status).toBe(413);
  });

  it("bare POST", async () => {
    expect((await handle(new Request("http://localhost/api/interpret"))).status).toBe(405);
  });

  it("manglende API-nøkkel gir en ryddig feil før strømmen starter", async () => {
    const h = createInterpretHandler({ ...deps, checkConfig: () => "ANTHROPIC_API_KEY mangler." });
    const res = await h(post({ text: "Bjelke" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "config", message: "ANTHROPIC_API_KEY mangler." } });
  });
});

describe("strømmen", () => {
  it("sender fremdrift, beskrivelse, delvis modell og resultat", async () => {
    const model = simpleBeam();
    const { deps, inputs } = fakeDeps(
      async (emit) => {
        emit({ type: "request", attempt: 1, resend: false });
        emit({ type: "text", delta: "En fritt " });
        emit({ type: "text", delta: "opplagt bjelke." });
        emit({ type: "input_json", delta: '{"model":{"nodes":[', snapshot: { model: { nodes: [] } } });
        emit({ type: "input_json", delta: '{"id":"A"', snapshot: { model: { nodes: [{ id: "A" }] } } });
        await tick();
        return result(model, { description: "En fritt opplagt bjelke.", questions: ["Er B et rullelager?"], costUsd: undefined });
      },
      { interpretOptions: { consistency: "never" } },
    );
    const res = await createInterpretHandler(deps)(post({ images: [PNG], text: "  Løs oppgave 2 " }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(inputs[0]).toEqual({ images: [PNG], text: "Løs oppgave 2" });

    const ev = await events(res);
    expect(ev.map((e) => (e.event === "progress" ? `progress:${e.data.stage}` : e.event))).toEqual([
      "progress:start",
      "progress:describing",
      "text",
      "text",
      "progress:modelling",
      "partial",
      "result",
    ]);
    const text = ev.flatMap((e) => (e.event === "text" ? [e.data.delta] : [])).join("");
    expect(text).toBe("En fritt opplagt bjelke.");
    // Bare siste delvise modell innenfor intervallet sendes.
    expect(ev.find((e) => e.event === "partial")!.data).toEqual({ model: { nodes: [{ id: "A" }] } });
    const last = ev.at(-1)!;
    expect(last.event).toBe("result");
    if (last.event !== "result") return;
    expect(last.data.model).toEqual(model);
    expect(last.data.questions).toEqual(["Er B et rullelager?"]);
    expect(last.data.costUsd).toBeNull();
    expect(last.data.usage.inputTokens).toBe(100);
    expect(Object.keys(last.data).sort()).toEqual(["costUsd", "description", "model", "questions", "usage", "warnings"]);
  });

  it("nytt forsøk skiller beskrivelsene, og et kall som sendes på nytt nullstiller teksten", async () => {
    const { deps } = fakeDeps(async (emit) => {
      emit({ type: "request", attempt: 1, resend: false });
      emit({ type: "text", delta: "Første." });
      emit({ type: "request", attempt: 2, resend: false });
      emit({ type: "text", delta: "Andre (brutt)" });
      emit({ type: "request", attempt: 2, resend: true });
      emit({ type: "text", delta: "Andre." });
      return result(simpleBeam(), { description: "Første.\n\nAndre." });
    });
    const ev = await events(await createInterpretHandler(deps)(post({ text: "Bjelke" })));
    const stages = ev.flatMap((e) => (e.event === "progress" ? [e.data.stage] : []));
    expect(stages).toContain("retry");
    expect(stages).toContain("resend");

    // Spill av hendelsene slik klienten gjør, og sammenlign med beskrivelsen i resultatet.
    let shown = "";
    for (const e of ev) {
      if (e.event === "text") shown += e.data.delta;
      if (e.event === "description") shown = e.data.text;
    }
    expect(shown).toBe("Første.\n\nAndre.");
  });

  it("self-consistency: bare første tolkning strømmes, og resultatet har consistency", async () => {
    const uncertain = { ...simpleBeam(), provenance: [{ entity_kind: "support" as const, entity: "B", field: "type", confidence: 0.4, note: "Uklart" }] };
    const { deps, created } = fakeDeps(
      async (emit) => {
        emit({ type: "text", delta: "Tekst" });
        return result(uncertain);
      },
      { interpretOptions: { consistency: "always", runs: 3 } },
    );
    const ev = await events(await createInterpretHandler(deps)(post({ text: "Bjelke" })));
    expect(created.filter((c) => c.onEvent)).toHaveLength(1);
    expect(ev.filter((e) => e.event === "text")).toHaveLength(1);
    expect(ev.some((e) => e.event === "progress" && e.data.stage === "consistency")).toBe(true);
    const last = ev.at(-1)!;
    expect(last.event === "result" && last.data.consistency).toMatchObject({ runs: 3, succeeded: 3 });
  });
});

describe("feil fra leverandøren", () => {
  const run = async (err: unknown) => {
    const log = vi.fn();
    const { deps } = fakeDeps(
      async () => {
        throw err;
      },
      { log },
    );
    const ev = await events(await createInterpretHandler(deps)(post({ text: "Bjelke" })));
    const last = ev.at(-1)!;
    expect(last.event).toBe("error");
    return { error: last.event === "error" ? last.data : undefined, log };
  };

  it("ugyldig modell etter alle forsøk", async () => {
    const { error } = await run(new InterpretError("Siste feil: noe teknisk", "invalid_model", EMPTY_USAGE, 0, 3, 100));
    expect(error).toEqual({ code: "invalid_model", message: expect.stringMatching(/etter 3 forsøk/) });
  });

  it("rate limit og avvist nøkkel fra API-et", async () => {
    expect((await run(new Anthropic.RateLimitError(429, { error: { message: "slow down" } }, "429", new Headers()))).error?.code).toBe("rate_limit");
    expect((await run(new Anthropic.AuthenticationError(401, { error: { message: "bad key" } }, "401", new Headers()))).error?.code).toBe("auth");
    expect((await run(new Anthropic.InternalServerError(529, { error: { message: "overloaded" } }, "529", new Headers()))).error?.code).toBe(
      "overloaded",
    );
  });

  it("uventede feil gir en generell melding uten stacktrace, og logges på serveren", async () => {
    const err = new Error("hemmelig intern detalj");
    const { error, log } = await run(err);
    expect(error).toEqual({ code: "internal", message: "Noe gikk galt under tolkningen. Prøv igjen." });
    expect(JSON.stringify(error)).not.toMatch(/hemmelig|at /);
    expect(log).toHaveBeenCalledWith(expect.any(String), err);
  });
});

describe("ClaudeProvider med onEvent (falsk klient)", () => {
  const model = simpleBeam();
  const message = {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    stop_reason: "tool_use",
    stop_details: null,
    content: [
      { type: "text", text: "En bjelke." },
      { type: "tool_use", id: "tu_1", name: "submit_model", input: { model, questions: [] } },
    ],
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };

  function fakeClient() {
    const registered: string[] = [];
    const requestOptions: unknown[] = [];
    const client = {
      beta: {
        messages: {
          stream(_params: unknown, options?: unknown) {
            requestOptions.push(options);
            const listeners: Record<string, (...args: unknown[]) => void> = {};
            return {
              on(event: string, cb: (...args: unknown[]) => void) {
                registered.push(event);
                listeners[event] = cb;
                return this;
              },
              async finalMessage() {
                listeners.text?.("En bjelke.", "En bjelke.");
                listeners.inputJson?.('{"model"', {});
                return message;
              },
            };
          },
        },
      },
    };
    return { client: client as unknown as Anthropic, registered, requestOptions };
  }

  it("sender request-, tekst- og input_json-hendelser og videresender signalet", async () => {
    const { client, requestOptions } = fakeClient();
    const seen: InterpretStreamEvent[] = [];
    const signal = new AbortController().signal;
    const r = await new ClaudeProvider({ client, onEvent: (e) => seen.push(e), signal }).interpret({ images: [], text: "Bjelke" });
    expect(r.model).toEqual(model);
    expect(seen).toEqual([
      { type: "request", attempt: 1, resend: false },
      { type: "text", delta: "En bjelke." },
      { type: "input_json", delta: '{"model"', snapshot: {} },
    ]);
    expect(requestOptions).toEqual([{ signal }]);
  });

  it("uten onEvent registreres ingen lyttere, og en feil i mottakeren stopper ikke tolkningen", async () => {
    const plain = fakeClient();
    await new ClaudeProvider({ client: plain.client }).interpret({ images: [], text: "Bjelke" });
    expect(plain.registered).toEqual([]);
    const throwing = fakeClient();
    const r = await new ClaudeProvider({
      client: throwing.client,
      onEvent: () => {
        throw new Error("visningen feilet");
      },
    }).interpret({ images: [], text: "Bjelke" });
    expect(r.attempts).toBe(1);
  });
});

describe("SSE-koding", () => {
  it("tåler hendelser delt over vilkårlige biter og CRLF", () => {
    const text = encodeSseEvent("text", { delta: "a\nb" }) + ": hjerteslag\n\n" + encodeSseEvent("result", { ok: true }).replace(/\n/g, "\r\n");
    const out: { event: string; data: string }[] = [];
    const p = createSseParser((m) => out.push(m));
    for (let i = 0; i < text.length; i += 3) p.push(text.slice(i, i + 3));
    p.end();
    expect(out).toEqual([
      { event: "text", data: JSON.stringify({ delta: "a\nb" }) },
      { event: "result", data: JSON.stringify({ ok: true }) },
    ]);
  });
});
