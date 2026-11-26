/**
 * Sjekker at alle fasitmodellene i testset/ følger skjemaet og er gyldige modeller.
 * Kjør: pnpm testset:check
 */
import { validateModel } from "../src/core/validate";
import { loadTestset } from "./testset";

const { cases, errors } = loadTestset();
let failed = errors.length > 0;

for (const e of errors) console.log(`✗ ${e.id}\n${e.message.replace(/^/gm, "    ")}`);
for (const c of cases) {
  const v = validateModel(c.truth);
  const d = v.determinacy;
  const status = v.ok ? "✓" : "✗";
  const ns = d ? `n_s = ${d.n_s} (${d.classification})` : "";
  const media = [c.input.images.length ? `${c.input.images.length} figur(er)` : "", c.input.text ? "tekst" : ""].filter(Boolean).join(" + ");
  console.log(`${status} ${c.id.padEnd(24)} ${c.meta.category.padEnd(6)} ${media.padEnd(20)} ${ns}${c.meta.example ? "  [eksempel]" : ""}`);
  for (const issue of v.issues) console.log(`    [${issue.level === "error" ? "feil" : "advarsel"}] ${issue.message}`);
  if (!v.ok) failed = true;
}

const real = cases.filter((c) => !c.meta.example);
const byCategory = (cat: string) => real.filter((c) => c.meta.category === cat).length;
console.log(`\n${real.length} oppgaver i testsettet (bjelker ${byCategory("beam")}, rammer ${byCategory("frame")}, fagverk ${byCategory("truss")}), ${cases.length - real.length} eksempler.`);
process.exit(failed ? 1 : 0);
