// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAuth } from "../src/ui/auth/auth.js";
import { Root } from "../src/ui/Root.js";
import { UploadPanel } from "../src/ui/upload/UploadPanel.js";

afterEach(() => {
  cleanup();
  useAuth.setState({ status: "disabled", user: null, notice: null });
  window.history.replaceState(null, "", "/");
});

describe("innlogging i appen", () => {
  it("utlogget: opplastingen ber om innlogging, eksemplene er fortsatt der", () => {
    useAuth.setState({ status: "signedOut" });
    render(<UploadPanel />);
    expect(screen.getByText("Logg inn for å laste opp egne oppgaver")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Tolk oppgaven/ })).toBeNull();
    expect(screen.getByRole("heading", { name: "Prøv et eksempel" })).toBeTruthy();
  });

  it("innlogget eller uten innlogging (lokalt): opplastingen vises", () => {
    useAuth.setState({ status: "signedIn", user: { id: "u1", email: "ola@stud.ntnu.no" } });
    render(<UploadPanel />);
    expect(screen.getByRole("button", { name: /Tolk oppgaven/ })).toBeTruthy();
  });

  it("forsiden har veien inn, og topplinjen viser hvem som er logget inn", () => {
    useAuth.setState({ status: "signedIn", user: { id: "u1", email: "ola@stud.ntnu.no" } });
    render(<Root />);
    expect(screen.getByRole("heading", { level: 1, name: "Se hva som skjer inni konstruksjonen" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Prøv et eksempel" }).getAttribute("href")).toBe("/app?eksempel=gerber");
    expect(screen.getByText("ola@stud.ntnu.no")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Logg ut" })).toBeTruthy();
  });

  it("utlogget forside lenker til innlogging", () => {
    useAuth.setState({ status: "signedOut" });
    render(<Root />);
    expect(screen.getByRole("link", { name: "Logg inn" }).getAttribute("href")).toBe("/logg-inn");
    expect(screen.getAllByRole("link", { name: "Opprett gratis bruker" })[0]!.getAttribute("href")).toBe("/logg-inn");
  });
});
