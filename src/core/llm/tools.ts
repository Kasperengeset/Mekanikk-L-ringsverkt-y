/**
 * Verktøydefinisjoner for LLM-en, generert fra Zod-skjemaet. Uavhengige av leverandør:
 * adapterne legger på leverandørspesifikke felt (f.eks. strict for Claude).
 */
import { SubmitModelInput, toLlmJsonSchema } from "../schema";

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export const SUBMIT_MODEL_TOOL: ToolDefinition = {
  name: "submit_model",
  description:
    "Submit the structural model of the statics problem, with questions for the student about anything ambiguous. Call exactly once, after describing the figure.",
  input_schema: toLlmJsonSchema(SubmitModelInput),
};
