/**
 * Tolkning med Claude. Én samtale: Claude beskriver figuren i tekst og kaller så submit_model.
 * Er modellen ugyldig (skjema eller referanser), får Claude feilene tilbake og prøver igjen.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { SubmitModelInput } from "../../src/core/schema";
import { formatIssues, validateModel } from "../../src/core/validate";
import { INTERPRET_SYSTEM_PROMPT, interpretUserText, invalidModelFeedback, missingToolCallReminder } from "../../src/core/llm/prompts";
import { SUBMIT_MODEL_TOOL } from "../../src/core/llm/tools";
import { addUsage, EMPTY_USAGE, InterpretError, type InterpretInput, type InterpretProvider, type InterpretResult, type Usage } from "./adapter";
import { costUsd } from "./pricing";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ClaudeOptions {
  /** Standard: INTERPRET_MODEL fra miljøet, ellers claude-opus-5-5. */
  model?: string;
  /** Standard: INTERPRET_EFFORT fra miljøet, ellers high (tolkningen er det usikre leddet). */
  effort?: Effort;
  /** Maks antall kall per tolkning, inkludert nye forsøk etter ugyldig modell. */
  maxAttempts?: number;
  /**
   * Strict tool use (grammatikkstyrt generering). Av som standard: API-et avviser skjemaet vårt
   * fordi den kompilerte grammatikken blir for stor. Zod-valideringen og nye forsøk med
   * feilmeldingene gir i praksis samme garanti.
   */
  strict?: boolean;
  client?: Anthropic;
}

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

/** Modeller der server-side fallback ved avslag er tilgjengelig. */
const supportsFallbacks = (model: string) => /^claude-(opus-5|sonnet-5-5|fable-5)/.test(model);

function toUsage(u: Anthropic.Beta.BetaUsage): Usage {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

export class ClaudeProvider implements InterpretProvider {
  readonly name: string;
  private readonly model: string;
  private readonly effort: Effort;
  private readonly maxAttempts: number;
  private readonly client: Anthropic;
  private readonly tool: Anthropic.Beta.BetaTool;

  constructor(options: ClaudeOptions = {}) {
    this.model = options.model ?? (process.env.INTERPRET_MODEL || "claude-opus-5-5");
    const envEffort = process.env.INTERPRET_EFFORT as Effort | undefined;
    this.effort = options.effort ?? (envEffort && EFFORTS.includes(envEffort) ? envEffort : "high");
    this.maxAttempts = options.maxAttempts ?? 3;
    this.client = options.client ?? new Anthropic();
    this.name = `claude:${this.model}@${this.effort}`;
    this.tool = {
      name: SUBMIT_MODEL_TOOL.name,
      description: SUBMIT_MODEL_TOOL.description,
      input_schema: SUBMIT_MODEL_TOOL.input_schema as Anthropic.Beta.BetaTool.InputSchema,
      // Opus 5.5 tillater ikke tvunget verktøykall, så prompten ber om kallet og vi sjekker at det kom.
      ...(options.strict ? { strict: true } : {}),
      // Modellen strømmes, så hele JSON-en kommer fortløpende. Vi validerer selv med Zod.
      eager_input_streaming: true,
    };
  }

  async interpret(input: InterpretInput): Promise<InterpretResult> {
    const started = performance.now();
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      {
        role: "user",
        content: [
          ...input.images.map(
            (img): Anthropic.Beta.BetaImageBlockParam => ({
              type: "image",
              source: { type: "base64", media_type: img.mediaType, data: img.data },
            }),
          ),
          { type: "text", text: interpretUserText(input.text) },
        ],
      },
    ];

    let usage = EMPTY_USAGE;
    let cost: number | undefined = 0;
    let description = "";
    let lastProblem = "";
    const retryReasons: string[] = [];

    const fail = (message: string, reason: InterpretError["reason"], attempts: number) =>
      new InterpretError(message, reason, usage, cost, attempts, performance.now() - started);

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const message = await this.send(messages);
      const u = toUsage(message.usage);
      usage = addUsage(usage, u);
      const c = costUsd(message.model, u);
      cost = cost === undefined || c === undefined ? undefined : cost + c;

      if (message.stop_reason === "refusal") throw fail(`Claude avslo forespørselen (${message.stop_details?.category ?? "ukjent kategori"}).`, "refusal", attempt);
      if (message.stop_reason === "max_tokens") throw fail("Svaret ble kuttet ved max_tokens.", "max_tokens", attempt);

      for (const block of message.content) if (block.type === "text") description += (description ? "\n\n" : "") + block.text;
      messages.push({ role: "assistant", content: message.content });

      const call = message.content.find(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === SUBMIT_MODEL_TOOL.name,
      );
      if (!call) {
        lastProblem = "Claude kalte ikke submit_model.";
        retryReasons.push(lastProblem);
        messages.push({ role: "user", content: missingToolCallReminder() });
        continue;
      }

      const parsed = SubmitModelInput.safeParse(call.input);
      if (parsed.success) {
        const validation = validateModel(parsed.data.model);
        if (validation.ok) {
          return {
            model: parsed.data.model,
            questions: parsed.data.questions,
            description,
            warnings: validation.issues,
            usage,
            costUsd: cost,
            latencyMs: performance.now() - started,
            attempts: attempt,
            retryReasons,
            servedBy: message.model,
          };
        }
        lastProblem = formatIssues(validation.issues.filter((i) => i.level === "error"));
      } else {
        lastProblem = z.prettifyError(parsed.error);
      }
      retryReasons.push(lastProblem);
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: call.id, is_error: true, content: invalidModelFeedback(lastProblem) }],
      });
    }
    throw fail(`Ingen gyldig modell etter ${this.maxAttempts} forsøk. Siste feil:\n${lastProblem}`, "invalid_model", this.maxAttempts);
  }

  /** Ett strømmet kall. Tool-input som ikke lar seg tolke som JSON, gir et nytt kall (maks 2). */
  private async send(messages: Anthropic.Beta.BetaMessageParam[]): Promise<Anthropic.Beta.BetaMessage> {
    for (let retry = 0; ; retry++) {
      const stream = this.client.beta.messages.stream({
        model: this.model,
        max_tokens: 64000,
        ...(supportsFallbacks(this.model)
          ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
          : {}),
        thinking: { type: "adaptive" },
        output_config: { effort: this.effort },
        system: [{ type: "text", text: INTERPRET_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools: [this.tool],
        tool_choice: { type: "auto", disable_parallel_tool_use: true },
        messages,
      });
      try {
        return await stream.finalMessage();
      } catch (err) {
        // API-feil (rate limit, autentisering, ...) skal ikke forveksles med ugyldig JSON.
        if (err instanceof Anthropic.APIError || retry >= 2) throw err;
      }
    }
  }
}
