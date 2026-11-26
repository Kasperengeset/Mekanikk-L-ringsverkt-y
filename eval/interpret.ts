/**
 * Kjører tolkningen mot testsettet og måler det Port 1 avgjøres på.
 *
 *   pnpm eval:interpret                       alle oppgaver (uten eksempler)
 *   pnpm eval:interpret --examples            ta med eksemplene
 *   pnpm eval:interpret --only bjelke-01,ramme-03
 *   pnpm eval:interpret --split tuning        bare oppgavene prompten justeres på (holdout: Port 1)
 *   pnpm eval:interpret --model claude-sonnet-5-5 --effort medium
 *   pnpm eval:interpret --consistency always --runs 3
 *   pnpm eval:interpret --dry-run             vis hva som ville blitt kjørt, uten API-kall
 *
 * Hver kjøring koster penger. Resultatene skrives til eval/results/.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { INTERPRET_SYSTEM_PROMPT } from "../src/core/llm/prompts";
import { SUBMIT_MODEL_TOOL } from "../src/core/llm/tools";
import { parseArgs } from "node:util";
import { COMPARE_KINDS, compareModels, type CompareResult, type EntityComparison } from "../src/core/compare";
import { ClaudeProvider } from "../server/llm/claude";
import { InterpretError } from "../server/llm/adapter";
import { interpretProblem, type ConsistencyMode, type InterpretOutcome } from "../server/interpret";
import { loadTestset, type TestCase } from "./testset";

try {
  process.loadEnvFile();
} catch {
  // Ingen .env – nøkkelen kan ligge i miljøet eller i en `ant auth login`-profil.
}

const { values: args } = parseArgs({
  options: {
    only: { type: "string" },
    examples: { type: "boolean", default: false },
    split: { type: "string" },
    model: { type: "string" },
    effort: { type: "string" },
    consistency: { type: "string", default: "low_confidence" },
    runs: { type: "string", default: "3" },
    concurrency: { type: "string", default: "4" },
    "low-confidence": { type: "string", default: "0.7" },
    "dry-run": { type: "boolean", default: false },
  },
});

const LOW = Number(args["low-confidence"]);
/** Fingeravtrykk av prompt og verktøyskjema, så hver kjøring kan knyttes til en promptversjon. */
const PROMPT_HASH = createHash("sha256").update(INTERPRET_SYSTEM_PROMPT).update(JSON.stringify(SUBMIT_MODEL_TOOL)).digest("hex").slice(0, 12);

interface CaseResult {
  id: string;
  category: string;
  ok: boolean;
  exact: boolean;
  error?: string;
  attempts: number;
  retryReasons?: string[];
  usage?: InterpretOutcome["usage"];
  costUsd?: number;
  latencyMs: number;
  servedBy?: string;
  counts?: CompareResult["counts"];
  failures?: (EntityComparison & { flagged: boolean })[];
  questions?: string[];
  description?: string;
  model?: InterpretOutcome["model"];
  consistency?: InterpretOutcome["consistency"];
}

/** En feil er flagget hvis den tolkede modellen har lav sikkerhet på en av entitetene feilen gjelder. */
function flagged(outcome: InterpretOutcome, e: EntityComparison): boolean {
  const low = new Set(outcome.model.provenance.filter((p) => p.confidence < LOW).map((p) => p.entity));
  return e.candidateIds.some((id) => low.has(id));
}

async function runCase(c: TestCase, provider: ClaudeProvider): Promise<CaseResult> {
  const base = { id: c.id, category: c.meta.category };
  try {
    const outcome = await interpretProblem(provider, c.input, {
      consistency: args.consistency as ConsistencyMode,
      runs: Number(args.runs),
      lowConfidence: LOW,
    });
    const cmp = compareModels(c.truth, outcome.model);
    return {
      ...base,
      ok: true,
      exact: cmp.exact,
      attempts: outcome.attempts,
      retryReasons: outcome.retryReasons,
      usage: outcome.usage,
      costUsd: outcome.costUsd,
      latencyMs: outcome.latencyMs,
      servedBy: outcome.servedBy,
      counts: cmp.counts,
      failures: cmp.entities.filter((e) => e.status !== "match").map((e) => ({ ...e, flagged: flagged(outcome, e) })),
      questions: outcome.questions,
      description: outcome.description,
      model: outcome.model,
      consistency: outcome.consistency,
    };
  } catch (err) {
    if (err instanceof InterpretError)
      return { ...base, ok: false, exact: false, error: `${err.reason}: ${err.message}`, attempts: err.attempts, costUsd: err.costUsd, latencyMs: err.latencyMs };
    throw err;
  }
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>, onDone: (r: R) => void): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]!);
        onDone(results[i]!);
      }
    }),
  );
  return results;
}

const pct = (x: number) => `${(100 * x).toFixed(0)} %`;
const ratio = (a: number, b: number) => (b === 0 ? "–" : pct(a / b));
const quantile = (xs: number[], q: number) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};

function report(results: CaseResult[], provider: string): string {
  const n = results.length;
  const exact = results.filter((r) => r.exact).length;
  const failed = results.filter((r) => !r.ok);
  const lines: string[] = [];
  lines.push(`# Tolkningseval – ${new Date().toISOString().slice(0, 16).replace("T", " ")}`);
  lines.push("");
  lines.push(`Leverandør: \`${provider}\` · prompt \`${PROMPT_HASH}\` · self-consistency: ${args.consistency} (${args.runs} kjøringer) · ${n} oppgaver${args.split ? ` · ${args.split}` : ""}`);
  lines.push("");

  const rate = n ? exact / n : 0;
  const verdict = rate >= 0.8 ? "videre til uke 2" : rate >= 0.5 ? "videre, men fortsett med tolkningen parallelt med uke 2" : "bytt input til tekst pluss enkel skisse";
  lines.push(`**Helt riktige modeller: ${exact} av ${n} (${pct(rate)})** → Port 1: ${verdict}.`);
  if (failed.length) lines.push(`\n${failed.length} oppgave(r) ga ingen gyldig modell og teller som feil.`);
  lines.push("");

  lines.push("## Treff per entitet");
  lines.push("");
  lines.push("| Entitet | Presisjon | Gjenfinning | Riktige | Feil/ekstra | Manglende |");
  lines.push("|---|---|---|---|---|---|");
  for (const kind of COMPARE_KINDS) {
    const t = { tp: 0, fp: 0, fn: 0 };
    for (const r of results) if (r.counts) for (const k of ["tp", "fp", "fn"] as const) t[k] += r.counts[kind][k];
    if (t.tp + t.fp + t.fn === 0) continue;
    lines.push(`| ${kind} | ${ratio(t.tp, t.tp + t.fp)} | ${ratio(t.tp, t.tp + t.fn)} | ${t.tp} | ${t.fp} | ${t.fn} |`);
  }
  lines.push("");

  const errs = results.flatMap((r) => r.failures ?? []);
  const flaggable = errs.filter((e) => e.candidateIds.length > 0);
  const flaggedCount = flaggable.filter((e) => e.flagged).length;
  lines.push("## Kalibrering");
  lines.push("");
  lines.push(
    `${flaggedCount} av ${flaggable.length} feil (${ratio(flaggedCount, flaggable.length)}) var markert med confidence < ${LOW}. Terskel: ≥ 70 %.`,
  );
  lines.push(`${errs.length - flaggable.length} entiteter manglet helt i tolkningen og kunne ikke flagges.`);
  lines.push("");

  const costs = results.map((r) => r.costUsd).filter((c): c is number => c !== undefined);
  const lat = results.map((r) => r.latencyMs / 1000);
  lines.push("## Kostnad og ventetid");
  lines.push("");
  lines.push(`Kostnad: ${costs.reduce((s, c) => s + c, 0).toFixed(2)} USD totalt, ${(costs.reduce((s, c) => s + c, 0) / Math.max(costs.length, 1)).toFixed(3)} USD per oppgave.`);
  lines.push(`Ventetid: median ${quantile(lat, 0.5).toFixed(1)} s, p90 ${quantile(lat, 0.9).toFixed(1)} s.`);
  lines.push("");

  lines.push("## Per oppgave");
  lines.push("");
  lines.push("| Oppgave | Kategori | Resultat | Forsøk | Kostnad | Tid | Feil |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const r of results) {
    const res = !r.ok ? "ingen modell" : r.exact ? "✓ riktig" : "✗ avvik";
    const fails = r.error ?? (r.failures ?? []).map((e) => `${e.kind} ${e.status}${e.flagged ? " (flagget)" : ""}: ${[...e.truthIds, ...e.candidateIds].join("/")}${e.detail ? ` – ${e.detail}` : ""}`).join("<br>");
    lines.push(`| ${r.id} | ${r.category} | ${res} | ${r.attempts} | ${r.costUsd?.toFixed(3) ?? "–"} | ${(r.latencyMs / 1000).toFixed(1)} s | ${fails.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`);
  }
  return lines.join("\n");
}

async function main() {
  const { cases: all, errors } = await loadTestset();
  for (const e of errors) console.error(`Hopper over ${e.id}: ${e.message}`);
  const only = args.only?.split(",").map((s) => s.trim());
  const cases = all.filter(
    (c) => (only ? only.includes(c.id) : args.examples || !c.meta.example) && (!args.split || c.meta.split === args.split),
  );
  if (cases.length === 0) {
    console.error("Ingen oppgaver å kjøre. Legg oppgaver i testset/ (se testset/README.md), eller bruk --examples.");
    process.exit(1);
  }

  const provider = new ClaudeProvider({
    ...(args.model ? { model: args.model } : {}),
    ...(args.effort ? { effort: args.effort as never } : {}),
  });
  console.log(`${cases.length} oppgaver med ${provider.name}, self-consistency: ${args.consistency}.`);
  if (args["dry-run"]) {
    for (const c of cases) console.log(`  ${c.id} (${c.meta.category}, ${c.input.images.length} figur(er)${c.input.text ? ", tekst" : ""})`);
    return;
  }

  const results = await pool(cases, Number(args.concurrency), (c) => runCase(c, provider), (r) =>
    console.log(`  ${r.exact ? "✓" : r.ok ? "✗" : "!"} ${r.id} (${(r.latencyMs / 1000).toFixed(1)} s${r.costUsd !== undefined ? `, ${r.costUsd.toFixed(3)} USD` : ""})`),
  );

  const md = report(results, provider.name);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const base = `eval/results/${stamp}-${provider.name.replace(/[^a-z0-9.-]+/gi, "_")}`;
  mkdirSync("eval/results", { recursive: true });
  writeFileSync(`${base}.json`, JSON.stringify({ provider: provider.name, promptHash: PROMPT_HASH, args, results }, null, 2));
  writeFileSync(`${base}.md`, md);
  console.log(`\n${md}\n\nLagret: ${base}.md og .json`);
}

main().catch((err) => {
  if (err instanceof Anthropic.AuthenticationError) {
    console.error("API-nøkkelen ble avvist (401). Sett en gyldig ANTHROPIC_API_KEY i miljøet eller i .env (se .env.example).");
  } else console.error(err);
  process.exit(1);
});
