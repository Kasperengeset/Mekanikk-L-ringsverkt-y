/**
 * Leser testsettet. Hver oppgave er en mappe i testset/ med:
 *   meta.json     kategori, kilde og eventuelle notater
 *   truth.json    fasitmodellen etter skjemaet i src/core/schema.ts
 *   figure*.png   figuren (png, jpg, webp eller gif), én eller flere
 *   problem.txt   oppgaveteksten (valgfri)
 * Se testset/README.md.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { Model } from "../src/core/schema";
import type { ImageMediaType, InterpretInput } from "../server/llm/adapter";

export const Meta = z.strictObject({
  category: z.enum(["beam", "frame", "truss"]),
  source: z.string().describe("Hvor oppgaven er hentet fra, f.eks. 'TKT4116 eksamen V2024 oppg. 2'."),
  example: z.boolean().default(false).describe("true for eksempler som ikke teller i testsettet."),
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

export function loadTestset(root = "testset"): { cases: TestCase[]; errors: { id: string; message: string }[] } {
  const cases: TestCase[] = [];
  const errors: { id: string; message: string }[] = [];
  if (!existsSync(root)) return { cases, errors };
  for (const id of readdirSync(root).sort()) {
    const dir = join(root, id);
    if (!statSync(dir).isDirectory()) continue;
    try {
      const read = (file: string) => JSON.parse(readFileSync(join(dir, file), "utf8"));
      const meta = Meta.parse(read("meta.json"));
      const truth = Model.parse(read("truth.json"));
      const images = readdirSync(dir)
        .filter((f) => /^figure.*\.(png|jpe?g|webp|gif)$/i.test(f))
        .sort()
        .map((f) => ({
          mediaType: MEDIA_TYPES[f.split(".").pop()!.toLowerCase()]!,
          data: readFileSync(join(dir, f)).toString("base64"),
        }));
      const textFile = join(dir, "problem.txt");
      const text = existsSync(textFile) ? readFileSync(textFile, "utf8") : undefined;
      if (images.length === 0 && !text) throw new Error("Mangler både figur og problem.txt.");
      cases.push({ id, dir, meta, truth, input: { images, ...(text ? { text } : {}) } });
    } catch (err) {
      const message = err instanceof z.ZodError ? z.prettifyError(err) : err instanceof Error ? err.message : String(err);
      errors.push({ id, message });
    }
  }
  return { cases, errors };
}
