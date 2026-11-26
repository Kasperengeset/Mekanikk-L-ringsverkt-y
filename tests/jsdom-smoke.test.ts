// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

describe("jsdom", () => {
  it("starter med Node-versjonen i prosjektet", () => {
    document.body.innerHTML = "<p>hei</p>";
    expect(document.querySelector("p")?.textContent).toBe("hei");
  });
});
