/**
 * MCP-serveren over ekte Streamable HTTP med SDK-klienten (fetch rett til handleren, uten nettverk),
 * OAuth-tokens signert med en testnøkkel, og kvoten med falsk Supabase.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import { mechanics } from "../server/modules/mechanics/tools.js";
import { createEntitlements, type Entitlements } from "../server/platform/entitlements.js";
import { createMcpHandler } from "../server/platform/mcp.js";
import { createTokenVerifier, protectedResourceMetadata } from "../server/platform/oauth.js";
import { FIXTURES } from "../src/ui/fixtures.js";
import { modelFromHash } from "../src/ui/share.js";

const SUPABASE_URL = "https://proj.supabase.co";
const ISSUER = `${SUPABASE_URL}/auth/v1`;

async function keys() {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test", alg: "ES256" };
  const sign = (claims: Record<string, unknown>, opts: { issuer?: string; expires?: string } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "ES256", kid: "test" })
      .setIssuer(opts.issuer ?? ISSUER)
      .setAudience("authenticated")
      .setSubject("11111111-2222-3333-4444-555555555555")
      .setIssuedAt()
      .setExpirationTime(opts.expires ?? "1h")
      .sign(privateKey);
  return { jwks: createLocalJWKSet({ keys: [jwk] }), sign };
}

async function connect(handler: (req: Request) => Promise<Response>, token?: string) {
  const transport = new StreamableHTTPClientTransport(new URL("https://moment.no/mcp"), {
    fetch: (url, init) => handler(new Request(url, init)),
    ...(token ? { requestInit: { headers: { authorization: `Bearer ${token}` } } } : {}),
  });
  const client = new Client({ name: "test", version: "1" });
  await client.connect(transport);
  return client;
}

/** Modellen slik Claude sender den: uten schemaVersion og provenance. */
const asInput = (m: Record<string, unknown>) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== "schemaVersion" && k !== "provenance"));

const textOf = (r: unknown) => ((r as { content: { type: string; text: string }[] }).content.find((c) => c.type === "text")?.text ?? "");

describe("MCP-serveren (åpen, lokal utvikling)", () => {
  const handler = createMcpHandler({ modules: [mechanics], log: () => {} });

  it("lister verktøyene med beskrivelser og JSON Schema", async () => {
    const client = await connect(handler);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["force_system", "solve_structure"]);
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.description).toMatch(/studenten/);
      expect(t.annotations?.readOnlyHint).toBe(true);
    }
    expect(client.getInstructions()).toMatch(/tallene alltid komme fra verktøyene/);
  });

  it("verktøyene peker på visningen i chatten, og ressursen gir HTML-filen fra nettstedet", async () => {
    const loadAsset = vi.fn(async (url: string) => `<!doctype html><p>${url}</p>`);
    const client = await connect(createMcpHandler({ modules: [mechanics], loadAsset, log: () => {} }));
    const { tools } = await client.listTools();
    for (const t of tools) expect(t._meta).toMatchObject({ ui: { resourceUri: "ui://mekanikk/visning.html" }, "ui/resourceUri": "ui://mekanikk/visning.html" });
    const { resources } = await client.listResources();
    expect(resources).toEqual([expect.objectContaining({ uri: "ui://mekanikk/visning.html", mimeType: "text/html;profile=mcp-app" })]);
    const read = await client.readResource({ uri: "ui://mekanikk/visning.html" });
    expect(read.contents[0]).toMatchObject({ mimeType: "text/html;profile=mcp-app", text: "<!doctype html><p>https://moment.no/mcp-ui/visning.html</p>" });
    expect(loadAsset).toHaveBeenCalledWith("https://moment.no/mcp-ui/visning.html");
  });

  it("force_system: tre krefter som i Øving 1 (egen utgave av tallene)", async () => {
    const client = await connect(handler);
    const r = await client.callTool({
      name: "force_system",
      arguments: {
        units: { length: "m", force: "N" },
        forces: [
          { id: "F1", magnitude: 600, angle_deg: 35 },
          { id: "F2", magnitude: 500, direction: { dx: -4, dz: 3 } },
          { id: "F3", magnitude: 800, direction: { dx: 0.2, dz: -0.4 } },
        ],
      },
    });
    const s = r.structuredContent as { view: string; resultant: { Rx: number; Rz: number; R: number } };
    expect(s.view).toBe("forces");
    expect(s.resultant.R).toBeCloseTo(455.0, 0);
    expect(s.resultant.Rx).toBeCloseTo(449.3, 1);
    expect(s.resultant.Rz).toBeCloseTo(-71.4, 1);
    const t = textOf(r);
    expect(t).toContain("F1z = 344,1 N");
    expect(t).toContain("R = √(Rx² + Rz²) = 454,9 N");
    expect(t).toMatch(/Ikke regn dem på nytt/);
  });

  it("force_system: manglende retning gir missing_fields, ikke en antakelse", async () => {
    const client = await connect(handler);
    const r = await client.callTool({ name: "force_system", arguments: { units: { length: "m", force: "N" }, forces: [{ id: "F1", magnitude: 600 }] } });
    expect(r.structuredContent).toMatchObject({ status: "missing", missing_fields: [{ field: "F1.direction" }] });
    expect(textOf(r)).toMatch(/spør studenten/);
  });

  it("solve_structure: utkrageren gir reaksjoner, snittkrefter og en lenke som åpner modellen", async () => {
    const client = await connect(handler);
    const r = await client.callTool({ name: "solve_structure", arguments: asInput(FIXTURES.utkrager!.model) });
    const s = r.structuredContent as { status: string; reactions: { node: string; V: number; M: number }[]; open_url: string; equilibrium_residual: number };
    expect(s.status).toBe("ok");
    expect((r.structuredContent as { view: string }).view).toBe("structure");
    expect(s.reactions[0]).toMatchObject({ node: "A", V: expect.closeTo(17, 9), M: expect.closeTo(44, 9) });
    expect(s.equilibrium_residual).toBeLessThan(1e-6);
    expect(s.open_url.startsWith("https://moment.no/app#m=")).toBe(true);
    expect(modelFromHash(new URL(s.open_url).hash)?.nodes).toEqual(FIXTURES.utkrager!.model.nodes);
    expect(textOf(r)).toContain("A: H = 0 kN, V = 17 kN, M = 44 kNm");
  });

  it("solve_structure: en mekanisme forklares, uten tall", async () => {
    const client = await connect(handler);
    const r = await client.callTool({
      name: "solve_structure",
      arguments: {
        units: { length: "m", force: "kN" },
        nodes: [
          { id: "A", x: 0, y: 0 },
          { id: "B", x: 4, y: 0 },
        ],
        members: [{ id: "AB", i: "A", j: "B", kind: "beam" }],
        supports: [
          { node: "A", type: "roller", angle_deg: 0 },
          { node: "B", type: "roller", angle_deg: 0 },
        ],
        loads: [{ id: "P", type: "point", member: "AB", at: 0.5, P: 10, angle_deg: -45 }],
      },
    });
    expect((r.structuredContent as { status: string }).status).toMatch(/mechanism|invalid/);
    expect(textOf(r)).not.toMatch(/Opplagerkrefter/);
  });

  it("GET og DELETE gir 405 (tilstandsløs), OPTIONS gir CORS", async () => {
    expect((await handler(new Request("https://moment.no/mcp", { method: "GET" }))).status).toBe(405);
    expect((await handler(new Request("https://moment.no/mcp", { method: "DELETE" }))).status).toBe(405);
    const pre = await handler(new Request("https://moment.no/mcp", { method: "OPTIONS" }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-headers")).toContain("authorization");
  });
});

describe("MCP-serveren med OAuth", () => {
  it("uten token: 401 med WWW-Authenticate som peker på metadataene", async () => {
    const { jwks } = await keys();
    const handler = createMcpHandler({ modules: [mechanics], verifyToken: createTokenVerifier(SUPABASE_URL, jwks), log: () => {} });
    const res = await handler(new Request("https://moment.no/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe('Bearer resource_metadata="https://moment.no/.well-known/oauth-protected-resource/mcp"');
  });

  it("feil utsteder eller utløpt token avvises; gyldig token gir brukeren til verktøyene", async () => {
    const { jwks, sign } = await keys();
    const consumeTask = vi.fn<Entitlements["consumeTask"]>(async () => ({ allowed: true, subscribed: false, used: 1, limit: 5 }));
    const handler = createMcpHandler({ modules: [mechanics], verifyToken: createTokenVerifier(SUPABASE_URL, jwks), entitlements: { consumeTask }, log: () => {} });
    const post = (token: string) =>
      handler(new Request("https://moment.no/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: "{}" }));
    expect((await post(await sign({}, { issuer: "https://annen.supabase.co/auth/v1" }))).status).toBe(401);
    const expired = await post(await sign({}, { expires: "-1m" }));
    expect(expired.status).toBe(401);
    expect(expired.headers.get("www-authenticate")).toContain('error="invalid_token"');

    const client = await connect(handler, await sign({ email: "ola@stud.ntnu.no", client_id: "claude" }));
    await client.callTool({ name: "force_system", arguments: { units: { length: "m", force: "N" }, forces: [{ id: "F", magnitude: 1, angle_deg: 0 }] } });
    expect(consumeTask).toHaveBeenCalledWith("11111111-2222-3333-4444-555555555555", expect.stringMatching(/^forces:[0-9a-f]{32}$/));
  });

  it("over kvoten: verktøyet svarer med en forklaring og lenke til konto, uten resultat", async () => {
    const { jwks, sign } = await keys();
    const handler = createMcpHandler({
      modules: [mechanics],
      verifyToken: createTokenVerifier(SUPABASE_URL, jwks),
      entitlements: { consumeTask: async () => ({ allowed: false, subscribed: false, used: 5, limit: 5 }) },
      log: () => {},
    });
    const client = await connect(handler, await sign({}));
    const r = await client.callTool({ name: "solve_structure", arguments: asInput(FIXTURES.gerber!.model) });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe("Du har brukt ukens 5 gratis oppgaver (5 av 5). Kvoten fylles opp igjen mandag. Med abonnement er det ingen grense: https://moment.no/konto");
  });

  it("metadataene peker på Supabase som autorisasjonsserver", () => {
    expect(protectedResourceMetadata("https://moment.no/mcp", SUPABASE_URL)).toMatchObject({
      resource: "https://moment.no/mcp",
      authorization_servers: [ISSUER],
      bearer_methods_supported: ["header"],
    });
  });
});

describe("kvoten (entitlements) mot Supabase", () => {
  const env = { VITE_SUPABASE_URL: SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x", SUPABASE_SECRET_KEY: "sb_secret_y", QUOTA_TASKS_PER_WEEK: "3" };

  it("kaller consume_task med secret key i apikey og taket fra miljøet", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Response.json([{ allowed: false, subscribed: false, used: 3, task_limit: 3 }]);
    }) as unknown as typeof fetch;
    const e = createEntitlements(env, fake)!;
    expect(await e.consumeTask("u1", "structure:abc")).toEqual({ allowed: false, subscribed: false, used: 3, limit: 3 });
    expect(calls[0]!.url).toBe(`${SUPABASE_URL}/rest/v1/rpc/consume_task`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ p_user: "u1", p_task: "structure:abc", p_limit: 3 });
    expect(new Headers(calls[0]!.init.headers).get("apikey")).toBe("sb_secret_y");
    expect(new Headers(calls[0]!.init.headers).get("authorization")).toBeNull();
  });

  it("nettverksfeil eller manglende secret key nekter i stedet for å slippe gjennom", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await createEntitlements(env, failing)!.consumeTask("u1", "k")).toHaveProperty("error");
    const noSecret = { ...env, SUPABASE_SECRET_KEY: undefined };
    expect(await createEntitlements(noSecret)!.consumeTask("u1", "k")).toHaveProperty("error");
    expect(createEntitlements({})).toBeUndefined();
  });
});
