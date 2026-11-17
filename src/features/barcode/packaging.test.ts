import { describe, expect, it } from "vitest";
import { translatePackaging } from "./packaging";

describe("confezione in italiano", () => {
  it("traduce i termini comuni", () => {
    expect(translatePackaging(["glass", "bottle", "metal", "cap"])).toEqual(["vetro", "bottiglia", "metallo", "tappo"]);
    expect(translatePackaging(["en:tetra-pak"])).toEqual(["brick"]);
    expect(translatePackaging(["Aluminium", "steel", "tray", "film", "sachet", "wrapper", "pot", "lid", "jar", "bag", "box", "can"])).toHaveLength(12);
  });

  it("senza doppioni dopo la traduzione, tenendo ciò che è già italiano", () => {
    expect(translatePackaging(["cardboard", "paperboard", "astuccio", "carton"])).toEqual(["cartone", "cartoncino", "astuccio"]);
    expect(translatePackaging(["plastic", "pet", "pp"])).toEqual(["plastica"]);
  });

  it("scarta ciò che non è in tabella e non è italiano", () => {
    expect(translatePackaging(["cardboard", "fr:emballage-bizarre", "unknown-thing"])).toEqual(["cartone"]);
  });

  it("le espressioni si scompongono in parole note", () => {
    expect(translatePackaging(["plastic-bottle"])).toEqual(["plastica", "bottiglia"]);
  });

  it("senza niente da mostrare l'elenco è vuoto", () => {
    expect(translatePackaging(["xyz"])).toEqual([]);
    expect(translatePackaging([])).toEqual([]);
    expect(translatePackaging(undefined)).toEqual([]);
  });
});
