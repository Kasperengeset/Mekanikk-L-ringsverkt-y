import { useMemo } from "react";
import { solve, type SolveResult } from "../../core/solver";
import { useStore } from "./store";

/** Løsningen for gjeldende modell. Regnes på nytt bare når modellen endres (typisk < 1 ms). */
export function useSolveResult(): SolveResult | null {
  const model = useStore((s) => s.model);
  return useMemo(() => (model ? solve(model) : null), [model]);
}
