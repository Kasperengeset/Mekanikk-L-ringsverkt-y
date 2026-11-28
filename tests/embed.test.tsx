// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { demoPayload } from "../src/ui/embed/demo.js";
import { EmbedApp } from "../src/ui/embed/EmbedApp.js";
import { useStore } from "../src/ui/state/store.js";

afterEach(cleanup);

describe("visningen i chatten", () => {
  it("kraftsystem: piler, tabell med summene og av/på for komponenter og resultant", () => {
    render(<EmbedApp payload={demoPayload("forces", "https://moment.no")} />);
    expect(screen.getByRole("img", { name: /3 krefter og resultant 454,9 N/ })).toBeTruthy();
    const table = screen.getByRole("table");
    expect(within(table).getByText("ΣFx = 449,3 N")).toBeTruthy();
    expect(within(table).getByText("ΣFz = -71,4 N")).toBeTruthy();
    expect(screen.getByText("R = 454,9 N")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resultant" }));
    expect(screen.queryByText("R = 454,9 N")).toBeNull();
  });

  it("konstruksjon: lastes i storen uten skjulte tall, med opplagerkrefter og lenke ut", () => {
    const openLink = vi.fn();
    render(<EmbedApp payload={demoPayload("gerber", "https://moment.no")} actions={{ openLink }} />);
    expect(useStore.getState().model?.asked).toEqual([]);
    const reactions = screen.getByRole("list", { name: "Opplagerkrefter" });
    expect(reactions.textContent).toContain("V = 13 kN");
    expect(reactions.textContent).toContain("M = 30 kNm");
    fireEvent.click(screen.getByRole("button", { name: "Åpne i appen" }));
    expect(String(openLink.mock.calls[0]![0]).startsWith("https://moment.no/app#m=")).toBe(true);
  });

  it("feil og venting gir en kort melding i stedet for en figur", () => {
    render(<EmbedApp payload={{ status: "mechanism", message: "Konstruksjonen er en mekanisme." }} />);
    expect(screen.getByText("Konstruksjonen er en mekanisme.")).toBeTruthy();
    cleanup();
    render(<EmbedApp payload={null} pending />);
    expect(screen.getByText("Regner …")).toBeTruthy();
  });
});
