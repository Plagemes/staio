import { describe, expect, it } from "vitest";
import { chooseRenderStyle, COLOR_PALETTES } from "./theme";

describe("scelta dello stile dal tema", () => {
  it("vivo si disegna a colori", () => {
    expect(chooseRenderStyle({ palette: "vivo" })).toBe("color");
  });

  it("tutti gli altri temi restano a incisione, anche senza tema", () => {
    for (const palette of ["bottega", "ardesia", "netto", "registro", "", null, undefined, "sconosciuto"]) {
      expect(chooseRenderStyle({ palette }), String(palette)).toBe("engraving");
    }
    expect(chooseRenderStyle({})).toBe("engraving");
  });

  it("solo vivo è a colori", () => {
    expect(COLOR_PALETTES).toEqual(["vivo"]);
  });

  it("una pagina con la propria tavolozza a inchiostro (la vetrina) resta a incisione anche con vivo", () => {
    expect(chooseRenderStyle({ palette: "vivo", ownInk: true })).toBe("engraving");
  });

  it("l'attributo data-model-style forza lo stile, in entrambe le direzioni", () => {
    expect(chooseRenderStyle({ palette: "vivo", override: "engraving" })).toBe("engraving");
    expect(chooseRenderStyle({ palette: "bottega", override: "color" })).toBe("color");
    expect(chooseRenderStyle({ palette: "vivo", ownInk: true, override: "color" })).toBe("color");
  });

  it("un valore non riconosciuto di data-model-style non conta", () => {
    expect(chooseRenderStyle({ palette: "vivo", override: "boh" })).toBe("color");
    expect(chooseRenderStyle({ palette: "ardesia", override: "" })).toBe("engraving");
  });
});
