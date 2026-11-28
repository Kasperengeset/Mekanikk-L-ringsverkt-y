import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpHandler } from "../server/platform/mcp.js";
import { createLiveSync } from "../server/platform/live.js";
import { mechanics } from "../server/modules/mechanics/tools.js";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createTokenVerifier } from "../server/platform/oauth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { applyLivePayload } from "../src/ui/live/live.js";
import { demoPayload } from "../src/ui/embed/demo.js";
import { useStore } from "../src/ui/state/store.js";

afterEach(() => useStore.getState().reset());

describe("direktekoblingen: serveren", () => {
  it("lagrer siste resultat med secret key via put_live_view", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response(null, { status: 204 }))) as unknown as typeof fetch;
    const live = createLiveSync({ VITE_SUPABASE_URL: "https://p.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "pk", SUPABASE_SECRET_KEY: "sb_secret_y" }, fake)!;
    await live.publish("u1", { view: "forces" });
    expect(calls[0]!.url).toBe("https://p.supabase.co/rest/v1/rpc/put_live_view");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ p_user: "u1", p_payload: { view: "forces" } });
    expect(createLiveSync({})).toBeUndefined();
  });

  it("en feil i lagringen stopper ikke verktøysvaret", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const log = vi.fn();
    const live = createLiveSync({ VITE_SUPABASE_URL: "https://p.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "pk", SUPABASE_SECRET_KEY: "s" }, failing, log)!;
    await expect(live.publish("u1", {})).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
  });

  it("verktøyene sender resultatet for den innloggede brukeren", async () => {
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k", alg: "ES256" }] });
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: "k" })
      .setIssuer("https://p.supabase.co/auth/v1")
      .setAudience("authenticated")
      .setSubject("user-1")
      .setExpirationTime("1h")
      .sign(privateKey);
    const publish = vi.fn(async () => {});
    const handler = createMcpHandler({ modules: [mechanics], verifyToken: createTokenVerifier("https://p.supabase.co", jwks), live: { publish }, log: () => {} });
    const transport = new StreamableHTTPClientTransport(new URL("https://moment.no/mcp"), {
      fetch: (url, init) => handler(new Request(url, init)),
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: "t", version: "1" });
    await client.connect(transport);
    await client.callTool({ name: "force_system", arguments: { units: { length: "m", force: "N" }, forces: [{ id: "F", magnitude: 10, angle_deg: 90 }] } });
    expect(publish).toHaveBeenCalledWith("user-1", expect.objectContaining({ view: "forces", resultant: expect.objectContaining({ R: 10 }) }));
  });
});

describe("direktekoblingen: appen", () => {
  it("en konstruksjon fra Claude lastes som modell, uten skjulte tall", () => {
    expect(applyLivePayload(demoPayload("gerber", "https://moment.no"))).toBe(true);
    const s = useStore.getState();
    expect(s.model?.nodes.map((n) => n.id)).toEqual(["A", "H", "P", "C"]);
    expect(s.model?.asked).toEqual([]);
    expect(s.phase).toBe("explore");
  });

  it("et kraftsystem vises i stedet for en modell", () => {
    applyLivePayload(demoPayload("gerber", "https://moment.no"));
    expect(applyLivePayload(demoPayload("forces", "https://moment.no"))).toBe(true);
    const s = useStore.getState();
    expect(s.model).toBeNull();
    expect(s.forces?.result.resultant.R).toBeCloseTo(454.9, 1);
  });

  it("ukjent eller ugyldig innhold vises ikke", () => {
    expect(applyLivePayload({ view: "structure", model: { nodes: "feil" } })).toBe(false);
    expect(applyLivePayload({ status: "missing" })).toBe(false);
    expect(useStore.getState().model).toBeNull();
  });
});
