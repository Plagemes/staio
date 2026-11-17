import { describe, expect, it } from "vitest";
import { parseFood } from "../ai-capture/ideasFood";
import { cookHref, pairHref } from "./saveActions";

describe("«Cosa cucinare» e «Con cosa sta bene» partono dall'alimento del lotto", () => {
  it("passano lo stesso parametro, con il nome codificato", () => {
    expect(cookHref("Latte intero")).toBe("/app/ricette/idee?alimento=Latte%20intero");
    expect(pairHref("Latte intero")).toBe("/app/ricette/abbinamenti?alimento=Latte%20intero");
    expect(parseFood(new URL(cookHref("Pane & burro"), "http://x").searchParams.get("alimento"))).toBe("Pane & burro");
  });
});
