// @vitest-environment jsdom
/** AgentPanel i jsdom med falsk transport: forslag, strømmet tekst, handlingslinjer og avbryt. */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { solve } from "../src/core/solver";
import { AgentPanel, SUGGESTIONS } from "../src/ui/agent/AgentPanel";
import type { AgentTransport } from "../src/ui/agent/client";
import { useAgentStore } from "../src/ui/agent/conversation";
import type { AgentContentBlock, AgentReply } from "../src/ui/agent/protocol";
import { FIXTURES } from "../src/ui/fixtures";
import { useStore } from "../src/ui/state/store";

const model = FIXTURES.gerber!.model;
const result = solve(model);

const reply = (content: AgentContentBlock[], stop_reason: AgentReply["stop_reason"] = "end_turn"): AgentReply => ({
  content,
  stop_reason,
  stop_details: null,
  model: "claude-opus-5-5",
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  costUsd: 0,
});

beforeEach(() => {
  useAgentStore.getState().reset();
  useStore.getState().loadModel(model);
});
afterEach(cleanup);

describe("AgentPanel", () => {
  it("viser forslag, studentens melding, strømmet tekst og handlinger", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const sent: string[] = [];
    const transport: AgentTransport = vi.fn(async (messages, h) => {
      const last = messages.at(-1)!;
      if (last.role === "user" && Array.isArray(last.content) && last.content[0]?.type === "text") {
        sent.push(last.content[0].text);
        h.onText?.("Momentet er **størst** ");
        await gate;
        h.onText?.("der V skifter fortegn.");
        return reply(
          [
            { type: "text", text: "Momentet er **størst** der V skifter fortegn.", citations: null },
            { type: "tool_use", id: "t1", name: "highlight", input: { targets: [], diagram_point: { member: "HP", quantity: "M", at: 0.5 } } },
          ] as AgentContentBlock[],
          "tool_use",
        );
      }
      return reply([{ type: "text", text: "Se uthevingen.", citations: null }] as AgentContentBlock[]);
    });
    useAgentStore.setState({ transport });
    render(<AgentPanel model={model} result={result} />);

    for (const s of SUGGESTIONS) expect(screen.getByRole("button", { name: s })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Forklar M-diagrammet" }));
    });
    expect(sent).toEqual(["Forklar M-diagrammet"]);
    // Mens svaret strømmer: teksten så langt, ingen forslag, og Avbryt i stedet for Send.
    expect(screen.getByText("Forklar M-diagrammet")).toBeTruthy();
    expect(screen.getByText("størst").tagName).toBe("STRONG");
    expect(screen.getByRole("button", { name: "Avbryt" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Gi meg et hint" })).toBeNull();

    await act(async () => {
      release();
      await vi.waitFor(() => expect(useAgentStore.getState().activity).toBeNull());
    });
    expect(screen.getByText("Uthevet M-diagrammet i HP ved 50 %")).toBeTruthy();
    expect(screen.getByText("Se uthevingen.")).toBeTruthy();
    expect(useStore.getState().diagramHighlight).toEqual({ member: "HP", quantity: "M", at: 0.5 });
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();

    // Ny samtale tømmer samtalen og fjerner uthevingen.
    fireEvent.click(screen.getByRole("button", { name: "Ny samtale" }));
    expect(screen.queryByText("Se uthevingen.")).toBeNull();
    expect(useStore.getState().diagramHighlight).toBeNull();
  });

  it("sender med Enter, og Avbryt stopper svaret", async () => {
    const transport: AgentTransport = (_m, h, signal) =>
      new Promise((_, reject) => {
        h.onText?.("Et langt svar");
        signal.addEventListener("abort", () => reject(new DOMException("Avbrutt", "AbortError")));
      });
    useAgentStore.setState({ transport });
    render(<AgentPanel model={model} result={result} />);
    const box = screen.getByRole("textbox", { name: "Melding til veilederen" });
    fireEvent.change(box, { target: { value: "Gi meg et hint" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect((box as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByText("Et langt svar")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
      await vi.waitFor(() => expect(useAgentStore.getState().activity).toBeNull());
    });
    expect(screen.getByText("(avbrutt)")).toBeTruthy();
    expect(screen.getByText("Avbrutt.")).toBeTruthy();
  });

  it("viser at veilederen venter på en spådom", async () => {
    const transport: AgentTransport = async () =>
      reply([{ type: "tool_use", id: "t1", name: "ask_prediction", input: { question: "Hva skjer?", options: [] } }] as AgentContentBlock[], "tool_use");
    useAgentStore.setState({ transport });
    render(<AgentPanel model={model} result={result} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Gi meg et hint" }));
      await vi.waitFor(() => expect(useStore.getState().prediction).not.toBeNull());
    });
    expect(screen.getByText("Venter på spådommen din …")).toBeTruthy();
    await act(async () => {
      useAgentStore.getState().abort();
      await vi.waitFor(() => expect(useAgentStore.getState().activity).toBeNull());
    });
    expect(useStore.getState().prediction).toBeNull();
  });
});
