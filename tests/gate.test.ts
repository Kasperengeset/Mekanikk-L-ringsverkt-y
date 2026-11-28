/** Innlogging, tilgangskoder og kvote (server/gate.ts) med falsk fetch – ingen kall mot Supabase eller Claude. */
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { createAgentHandler, isStudentTurn } from "../server/agentHandler.js";
import { createGate, LOGIN_EXPIRED, LOGIN_REQUIRED, quotaFromEnv, type Gate } from "../server/gate.js";
import { createInterpretHandler } from "../server/interpretHandler.js";
import { legacyRedirect } from "../src/ui/router.js";
import { safeNext } from "../src/ui/site/LoginPage.js";

const SUPABASE = { VITE_SUPABASE_URL: "https://proj.supabase.co/", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x", SUPABASE_SECRET_KEY: "sb_secret_y" };
const req = (headers: Record<string, string> = {}) => new Request("http://x/api/agent", { method: "POST", headers });

/** Falsk Supabase: «good» er et gyldig token, kvoten styres av `allowed`. */
function fakeSupabase(allowed = true) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), ...(init ? { init } : {}) });
    const u = String(url);
    if (u.endsWith("/auth/v1/user")) {
      const auth = new Headers(init?.headers).get("authorization");
      return auth === "Bearer good" ? Response.json({ id: "u1", email: "ola@stud.ntnu.no" }) : new Response("{}", { status: 401 });
    }
    if (u.endsWith("/rest/v1/rpc/consume_quota")) return Response.json([{ allowed, used: allowed ? 3 : 10 }]);
    return new Response("nei", { status: 404 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe("porten", () => {
  it("uten Supabase og uten koder er API-et åpent (lokal utvikling)", async () => {
    expect(await createGate({}).admit(req())).toEqual({});
  });

  it("uten Supabase kreves tilgangskode når koder finnes", async () => {
    const gate = createGate({ ACCESS_CODES: "ola-1" });
    expect(await gate.admit(req())).toMatchObject({ denial: { status: 401, code: "access" } });
    expect(await gate.admit(req({ "x-access-code": "OLA-1" }))).toEqual({});
    expect(await gate.admit(req({ "x-access-code": "feil" }))).toMatchObject({ denial: { code: "access" } });
  });

  it("med Supabase kreves innlogging; gyldig token gir brukeren", async () => {
    const { fetchImpl, calls } = fakeSupabase();
    const gate = createGate(SUPABASE, fetchImpl);
    expect(await gate.admit(req())).toEqual({ denial: { status: 401, code: "login", message: LOGIN_REQUIRED } });
    expect(await gate.admit(req({ authorization: "Bearer gammel" }))).toEqual({ denial: { status: 401, code: "login", message: LOGIN_EXPIRED } });
    expect(await gate.admit(req({ authorization: "Bearer good" }))).toEqual({ user: { id: "u1", email: "ola@stud.ntnu.no" } });
    expect(calls[0]!.url).toBe("https://proj.supabase.co/auth/v1/user");
  });

  it("tilgangskode slipper forbi innloggingen (testbrukere), uten kvote", async () => {
    const { fetchImpl, calls } = fakeSupabase();
    const gate = createGate({ ...SUPABASE, ACCESS_CODES: "ola-1" }, fetchImpl);
    expect(await gate.admit(req({ "x-access-code": "ola-1" }))).toEqual({});
    expect(await gate.consume(undefined, "interpret")).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("kvoten trekkes med secret key, og et nei gir 429 med en forklaring", async () => {
    const ok = fakeSupabase(true);
    const user = { id: "u1" };
    expect(await createGate(SUPABASE, ok.fetchImpl).consume(user, "interpret")).toBeUndefined();
    const call = ok.calls[0]!;
    expect(call.url).toBe("https://proj.supabase.co/rest/v1/rpc/consume_quota");
    expect(JSON.parse(String(call.init!.body))).toEqual({ p_user: "u1", p_kind: "interpret", p_limit: 10 });
    // Den nye secret-nøkkelen er ikke JWT og skal bare stå i apikey.
    expect(new Headers(call.init!.headers).get("apikey")).toBe("sb_secret_y");
    expect(new Headers(call.init!.headers).get("authorization")).toBeNull();

    const no = fakeSupabase(false);
    const denial = await createGate({ ...SUPABASE, QUOTA_INTERPRET_PER_WEEK: "5" }, no.fetchImpl).consume(user, "interpret");
    expect(denial).toMatchObject({ status: 429, code: "quota" });
    expect(denial!.message).toContain("5 tolkningene");
  });

  it("uten secret key stoppes forespørselen i stedet for å bruke Claude uten kvote", async () => {
    const { VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY } = SUPABASE;
    expect(await createGate({ VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY }).consume({ id: "u1" }, "agent")).toMatchObject({ status: 500, code: "config" });
  });

  it("nettverksfeil mot Supabase gir 503, ikke åpen tilgang", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const gate = createGate(SUPABASE, failing);
    expect(await gate.admit(req({ authorization: "Bearer good" }))).toMatchObject({ denial: { status: 503, code: "unavailable" } });
    expect(await gate.consume({ id: "u1" }, "agent")).toMatchObject({ status: 503 });
  });

  it("kvotene kan settes i miljøet; ugyldige verdier gir standarden", () => {
    expect(quotaFromEnv({ QUOTA_INTERPRET_PER_WEEK: "3", QUOTA_AGENT_PER_WEEK: "20" })).toEqual({ interpret: 3, agent: 20, agent_call: 140 });
    expect(quotaFromEnv({ QUOTA_INTERPRET_PER_WEEK: "mange" }).interpret).toBe(10);
  });
});

describe("porten i handlerne", () => {
  const gate = (denyKind?: string): Gate & { consumed: string[] } => {
    const consumed: string[] = [];
    return {
      consumed,
      admit: async (r) => (r.headers.get("authorization") ? { user: { id: "u1" } } : { denial: { status: 401, code: "login", message: LOGIN_REQUIRED } }),
      consume: async (_u, kind) => {
        consumed.push(kind);
        return kind === denyKind ? { status: 429, code: "quota", message: "Tom." } : undefined;
      },
    };
  };
  const post = (body: unknown, auth = true) =>
    new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: "Bearer t" } : {}) }, body: JSON.stringify(body) });

  it("veilederen: et spørsmål teller som agent og agent_call, et verktøysvar bare som agent_call", async () => {
    const createClient = vi.fn(() => ({}) as Anthropic);
    const g = gate("agent");
    const handle = createAgentHandler({ createClient, gate: g, log: () => {} });
    const res = await handle(post({ messages: [{ role: "user", content: "Hvorfor er M størst her?" }] }));
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("quota");
    expect(g.consumed).toEqual(["agent"]);
    expect(createClient).not.toHaveBeenCalled();

    const toolTurn = [
      { role: "user", content: "Hei" },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "get_state", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "{}" }] },
    ];
    expect(isStudentTurn(toolTurn as never)).toBe(false);
    expect(isStudentTurn([{ role: "user", content: [{ type: "text", text: "Hei" }] }] as never)).toBe(true);
  });

  it("uten innlogging svarer begge handlerne 401 login før forespørselen leses", async () => {
    const agent = createAgentHandler({ createClient: () => ({}) as Anthropic, gate: gate(), log: () => {} });
    const interpret = createInterpretHandler({ createProvider: () => ({}) as never, gate: gate(), log: () => {} });
    for (const handle of [agent, interpret]) {
      const res = await handle(post({}, false));
      expect(res.status).toBe(401);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("login");
    }
  });

  it("tolkningen trekker én tolkning fra kvoten", async () => {
    const g = gate("interpret");
    const interpret = createInterpretHandler({ createProvider: () => ({}) as never, gate: g, log: () => {} });
    const res = await interpret(post({ text: "Fritt opplagt bjelke, L = 4 m." }));
    expect(res.status).toBe(429);
    expect(g.consumed).toEqual(["interpret"]);
  });
});

describe("sidene", () => {
  it("gamle lenker til verktøyet sendes til /app", () => {
    expect(legacyRedirect("/", "?eksempel=gerber")).toBe("/app?eksempel=gerber");
    expect(legacyRedirect("/", "?kode=ola-1")).toBe("/app?kode=ola-1");
    expect(legacyRedirect("/", "")).toBeUndefined();
    expect(legacyRedirect("/app", "?eksempel=gerber")).toBeUndefined();
  });

  it("etter innlogging går studenten bare til interne sider", () => {
    expect(safeNext("?neste=/app")).toBe("/app");
    expect(safeNext("?neste=//evil.example")).toBe("/app");
    expect(safeNext("?neste=https://evil.example")).toBe("/app");
    expect(safeNext("")).toBe("/app");
  });
});
