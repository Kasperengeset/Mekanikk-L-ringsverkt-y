/** Tilgangskoder: sjekken på serveren, headeren fra klientene og ?kode= i adressen. Ingen kall mot Claude. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCESS_INVALID, ACCESS_MISSING, checkAccess, parseAccessCodes } from "../server/access.js";
import { createAgentHandler } from "../server/agentHandler.js";
import { createInterpretHandler } from "../server/interpretHandler.js";
import { createAgentTransport } from "../src/ui/agent/client.js";
import { accessHeaders, captureAccessCodeFromUrl, clearAccessCode, getAccessCode, setAccessCode } from "../src/ui/api/access.js";
import { interpretRemote } from "../src/ui/api/interpret.js";
import { ACCESS_HEADER } from "../src/ui/api/protocol.js";

const request = (code?: string, body = "{}") =>
  new Request("http://localhost/api/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...(code !== undefined ? { [ACCESS_HEADER]: code } : {}) },
    body,
  });

afterEach(() => clearAccessCode());

describe("checkAccess", () => {
  it("er åpen uten ACCESS_CODES", () => {
    expect(checkAccess(request(), undefined)).toBeUndefined();
    expect(checkAccess(request(), " , ")).toBeUndefined();
  });

  it("krever en kode når ACCESS_CODES er satt", () => {
    expect(checkAccess(request(), "ola-7f3k")).toBe(ACCESS_MISSING);
    expect(checkAccess(request(""), "ola-7f3k")).toBe(ACCESS_MISSING);
    expect(checkAccess(request("feil"), "ola-7f3k")).toBe(ACCESS_INVALID);
  });

  it("godtar hver av kodene, uten forskjell på store og små bokstaver", () => {
    const codes = "ola-7f3k, KARI-9x2m\nper_1";
    expect(parseAccessCodes(codes)).toEqual(["ola-7f3k", "kari-9x2m", "per_1"]);
    for (const c of ["ola-7f3k", "kari-9X2M", "per_1"]) expect(checkAccess(request(c), codes)).toBeUndefined();
    expect(checkAccess(request("ola-7f3"), codes)).toBe(ACCESS_INVALID);
  });
});

describe("handlerne", () => {
  const authorize = (req: Request) => checkAccess(req, "ola-7f3k");
  const never = (): never => {
    throw new Error("skal ikke kalles");
  };
  const interpret = createInterpretHandler({ authorize, createProvider: never, checkConfig: () => "ingen nøkkel" });
  const agent = createAgentHandler({ authorize, createClient: never, checkConfig: () => "ingen nøkkel" });

  it.each([
    ["interpret", interpret],
    ["agent", agent],
  ])("%s svarer 401 før forespørselen leses", async (_name, handle) => {
    const res = await handle(request(undefined, "ikke json"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "access", message: ACCESS_MISSING } });
  });

  it("slipper gjennom med riktig kode (og stopper så ved konfigurasjonen)", async () => {
    const i = await interpret(request("ola-7f3k", JSON.stringify({ text: "Bjelke" })));
    expect([i.status, (await i.json()).error.code]).toEqual([500, "config"]);
    const a = await agent(request("OLA-7F3K", JSON.stringify({ messages: [{ role: "user", content: "Hei" }] })));
    expect([a.status, (await a.json()).error.code]).toEqual([500, "config"]);
  });
});

describe("klientene", () => {
  const denied = () =>
    vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () =>
      Response.json({ error: { code: "access", message: ACCESS_INVALID } }, { status: 401 }),
    );

  it("sender den lagrede koden og gir feilkoden access ved 401", async () => {
    setAccessCode("ola-7f3k");
    expect(accessHeaders()).toEqual({ [ACCESS_HEADER]: "ola-7f3k" });
    const fetch = denied();
    await expect(interpretRemote({ images: [], text: "Bjelke" }, {}, { fetch: fetch as unknown as typeof globalThis.fetch })).rejects.toMatchObject({
      code: "access",
      message: ACCESS_INVALID,
    });
    const transport = createAgentTransport({ fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(transport([{ role: "user", content: "Hei" }], {}, new AbortController().signal)).rejects.toMatchObject({ code: "access" });
    expect(fetch.mock.calls.map((c) => new Headers(c[1]?.headers).get(ACCESS_HEADER))).toEqual(["ola-7f3k", "ola-7f3k"]);
  });

  it("sender ingen header uten kode", async () => {
    const fetch = denied();
    await expect(interpretRemote({ images: [], text: "Bjelke" }, {}, { fetch: fetch as unknown as typeof globalThis.fetch })).rejects.toThrow();
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).has(ACCESS_HEADER)).toBe(false);
  });
});

describe("?kode= i adressen", () => {
  const capture = (href: string) => {
    const replaceState = vi.fn();
    captureAccessCodeFromUrl({ href }, { replaceState, state: null });
    return replaceState.mock.calls[0]?.[2] as string | undefined;
  };

  it("lagrer koden og fjerner den fra adressen, resten blir stående", () => {
    expect(capture("https://app.example/?eksempel=bjelke&kode=ola-7f3k#a")).toBe("/?eksempel=bjelke#a");
    expect(getAccessCode()).toBe("ola-7f3k");
  });

  it("fjerner en ugyldig kode uten å lagre den", () => {
    expect(capture("https://app.example/?kode=%C3%B8l")).toBe("/");
    expect(getAccessCode()).toBeNull();
  });

  it("rører ikke adressen uten ?kode=", () => {
    expect(capture("https://app.example/?eksempel=bjelke")).toBeUndefined();
  });
});
