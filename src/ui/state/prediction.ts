/**
 * Spådom som løfte: agentens ask_prediction venter her til studenten har svart i appen
 * (answerPrediction i storen). Avbrytes med en AbortSignal, f.eks. når studenten lukker samtalen.
 */
import { useStore, type PredictionAnswer } from "./store";

let counter = 0;

export function requestPrediction(question: string, options: string[], signal?: AbortSignal): Promise<PredictionAnswer> {
  const id = `p${Date.now().toString(36)}${counter++}`;
  useStore.getState().askPrediction({ id, question, options });
  return new Promise((resolve, reject) => {
    const unsubscribe = useStore.subscribe((s) => {
      const answer = s.predictionAnswers[id];
      if (answer) {
        unsubscribe();
        resolve(answer);
      }
    });
    signal?.addEventListener("abort", () => {
      unsubscribe();
      if (useStore.getState().prediction?.id === id) useStore.getState().askPrediction(null);
      reject(new DOMException("Avbrutt", "AbortError"));
    });
  });
}
