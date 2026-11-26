/**
 * Leser testsettet. Hver oppgave er en mappe i testset/ med:
 *   meta.json     kategori, kilde og eventuelle notater
 *   truth.json    fasitmodellen etter skjemaet i src/core/schema.ts
 *   figure*.png   figuren (png, jpg, webp eller gif), én eller flere
 *   *.pdf         eller oppgaven som PDF; sidene rendres som i nettleseren (meta.pages velger sider)
 *   problem.txt   oppgaveteksten (valgfri)
 * Se testset/README.md.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { Model } from "../src/core/schema";
import type { ImageMediaType, InterpretInput } from "../server/llm/adapter";
import { renderPdfInNode } from "../server/pdf";

export const Meta = z.strictObject({
  category: z.enum(["beam", "frame", "truss"]),
  source: z.string().describe("Hvor oppgaven er hentet fra, f.eks. 'TKT4116 eksamen V2024 oppg. 2'."),
  example: z.boolean().default(false).describe("true for eksempler som ikke teller i testsettet."),
  pages: z.array(z.number().int().positive()).optional().describe("Sidene i PDF-en som sendes til tolkningen, 1-basert. Standard: alle."),
  split: z
    .enum(["tuning", "holdout"])
    .optional()
    .describe("tuning: brukes til å justere prompten. holdout: brukes bare til å måle Port 1."),
  notes: z.string().optional(),
});
export type Meta = z.infer<typeof Meta>;

export interface TestCase {
  id: string;
  dir: string;
  meta: Meta;
  truth: Model;
  input: InterpretInput;
}

const MEDIA_TYPES: Record<string, ImageMediaType> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export interface TestsetLoad {
  cases: TestCase[];
  /** Mapper med oppgave og meta.json, men uten truth.json ennå. */
  pending: { id: string; meta: Meta }[];
  errors: { id: string; message: string }[];
}

/** @param options.inputs false hopper over figurer og PDF-rendring når bare fasitmodellene trengs. */
export async function loadTestset(root = "testset", options: { inputs?: boolean } = {}): Promise<TestsetLoad> {
  const withInputs = options.inputs ?? true;
  const cases: TestCase[] = [];
  const pending: TestsetLoad["pending"] = [];
  const errors: { id: string; message: string }[] = [];
  if (!existsSync(root)) return { cases, pending, errors };
  for (const id of readdirSync(root).sort()) {
    const dir = join(root, id);
    if (!statSync(dir).isDirectory()) continue;
    try {
      const read = (file: string) => JSON.parse(readFileSync(join(dir, file), "utf8"));
      const meta = Meta.parse(read("meta.json"));
      if (!existsSync(join(dir, "truth.json"))) {
        pending.push({ id, meta });
        continue;
      }
      const truth = Model.parse(read("truth.json"));
      const images: InterpretInput["images"] = [];
      for (const f of withInputs ? readdirSync(dir).sort() : []) {
        const ext = f.split(".").pop()!.toLowerCase();
        if (ext === "pdf") {
          const pages = await renderPdfInNode(readFileSync(join(dir, f)), meta.pages ? { pages: meta.pages } : {});
          for (const p of pages) images.push({ mediaType: "image/png", data: Buffer.from(p.png).toString("base64") });
        } else if (/^figure/i.test(f) && MEDIA_TYPES[ext]) {
          images.push({ mediaType: MEDIA_TYPES[ext], data: readFileSync(join(dir, f)).toString("base64") });
        }
      }
      const textFile = join(dir, "problem.txt");
      const text = existsSync(textFile) ? readFileSync(textFile, "utf8") : undefined;
      if (withInputs && images.length === 0 && !text) throw new Error("Mangler både figur, PDF og problem.txt.");
      cases.push({ id, dir, meta, truth, input: { images, ...(text ? { text } : {}) } });
    } catch (err) {
      const message = err instanceof z.ZodError ? z.prettifyError(err) : err instanceof Error ? err.message : String(err);
      errors.push({ id, message });
    }
  }
  return { cases, pending, errors };
}
