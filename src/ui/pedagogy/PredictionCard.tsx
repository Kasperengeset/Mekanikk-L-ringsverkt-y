/**
 * Spådomskortet: agentens ask_prediction venter (requestPrediction) til studenten har svart her.
 * Knapper for alternativene, eller et tekstfelt når options er tom. «Vet ikke» er alltid lov.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useStore, type PredictionRequest } from "../state/store";

export function PredictionCard() {
  const prediction = useStore((s) => s.prediction);
  if (!prediction) return null;
  // Ny id gir nytt kort (tomt tekstfelt).
  return <Card key={prediction.id} request={prediction} />;
}

function Card({ request }: { request: PredictionRequest }) {
  const answerPrediction = useStore((s) => s.answerPrediction);
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const questionId = useId();

  useEffect(() => {
    const el = ref.current;
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (t) answerPrediction(request.id, { text: t });
  };

  return (
    <div className="pd-prediction" ref={ref} role="group" aria-labelledby={questionId}>
      <p className="pd-prediction-kicker">Hva tror du?</p>
      <p className="pd-prediction-question" id={questionId}>
        {request.question}
      </p>
      {request.options.length > 0 ? (
        <div className="pd-prediction-options">
          {request.options.map((option, k) => (
            <button key={k} type="button" onClick={() => answerPrediction(request.id, { text: option, optionIndex: k })}>
              {option}
            </button>
          ))}
        </div>
      ) : (
        <form className="pd-prediction-form" onSubmit={submit}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Skriv hva du tror skjer, og hvorfor" aria-label="Ditt svar" />
          <button type="submit" disabled={!text.trim()}>
            Svar
          </button>
        </form>
      )}
      <button type="button" className="pd-link" onClick={() => answerPrediction(request.id, { text: "Vet ikke" })}>
        Vet ikke
      </button>
    </div>
  );
}
