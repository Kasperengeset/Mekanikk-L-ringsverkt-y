// @vitest-environment jsdom
/** AccessGate og ny kjøring etter at tilgangskoden er skrevet inn. Falsk transport, ingen kall mot Claude. */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_MISSING } from "../server/access.js";
import { AccessGate } from "../src/ui/access/AccessGate.js";
import { AgentApiError, type AgentTransport } from "../src/ui/agent/client.js";
import { useAgentStore } from "../src/ui/agent/conversation.js";
import type { AgentContentBlock, AgentReply } from "../src/ui/agent/protocol.js";
import { clearAccessCode, dismissAccess, getAccessCode, requireAccess, useAccess } from "../src/ui/api/access.js";
import { FIXTURES } from "../src/ui/fixtures.js";
import { useStore } from "../src/ui/state/store.js";

const reply = (text: string): AgentReply => ({
  content: [{ type: "text", text, citations: null }] as AgentContentBlock[],
  stop_reason: "end_turn",
  stop_details: null,
  model: "claude-opus-5-5",
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  costUsd: 0,
});

beforeEach(() => {
  clearAccessCode();
  dismissAccess();
  useAgentStore.getState().reset();
  useStore.getState().loadModel(FIXTURES.gerber!.model);
});
afterEach(cleanup);

describe("AccessGate", () => {
  it("vises bare når serveren har bedt om koden, og kjører forespørselen på nytt", () => {
    const { container } = render(<AccessGate />);
    expect(container.innerHTML).toBe("");

    const retry = vi.fn();
    act(() => requireAccess(ACCESS_MISSING, retry));
    expect(screen.getByText(ACCESS_MISSING)).toBeTruthy();

    const input = screen.getByRole("textbox", { name: "Tilgangskode" });
    fireEvent.change(input, { target: { value: "øl" } });
    fireEvent.click(screen.getByRole("button", { name: "Lagre og prøv igjen" }));
    expect(screen.getByText(/kan bare inneholde/)).toBeTruthy();
    expect(retry).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: " ola-7f3k " } });
    fireEvent.click(screen.getByRole("button", { name: "Lagre og prøv igjen" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(getAccessCode()).toBe("ola-7f3k");
    expect(container.innerHTML).toBe("");
  });
});

describe("veilederen uten tilgangskode", () => {
  it("ber om koden og sender den samme samtalen på nytt", async () => {
    const seen: number[] = [];
    let calls = 0;
    const transport: AgentTransport = vi.fn(async (messages) => {
      seen.push(messages.length);
      if (calls++ === 0) throw new AgentApiError(ACCESS_MISSING, "access");
      return reply("Start med et fritt-legeme-diagram.");
    });
    useAgentStore.setState({ transport });

    const first = await useAgentStore.getState().send("Hvordan finner jeg reaksjonene?");
    expect(first).toMatchObject({ status: "error", code: "access" });
    expect(useAccess.getState().message).toBe(ACCESS_MISSING);

    await act(async () => {
      useAccess.getState().retry?.();
    });
    expect(seen).toEqual([1, 1]);
    const entries = useAgentStore.getState().entries;
    expect(entries.filter((e) => e.kind === "student")).toHaveLength(1);
    expect(entries.at(-1)).toMatchObject({ kind: "tutor", text: "Start med et fritt-legeme-diagram." });
  });

  it("retry gjør ingenting når siste melding allerede har fått svar", async () => {
    const transport: AgentTransport = vi.fn(async () => reply("Hei!"));
    useAgentStore.setState({ transport });
    await useAgentStore.getState().send("Hei");
    expect(await useAgentStore.getState().retry()).toBeUndefined();
    expect(transport).toHaveBeenCalledOnce();
  });
});
