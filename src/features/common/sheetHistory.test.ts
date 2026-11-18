import { describe, expect, it } from "vitest";
import { backRequest, closeSheetThen, isInternalHref, isOwnEntry, sheetMarkerOf, systemClosesDialogs, withSheetMarker } from "./sheetHistory";

describe("il passo del foglio nella cronologia", () => {
  const next = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: ["", {}], renderedSearch: "" } };

  it("aggiunge il segno senza perdere lo stato del router", () => {
    const state = withSheetMarker(next, "a-1");
    expect(state.__NA).toBe(true);
    expect(state.__PRIVATE_NEXTJS_INTERNALS_TREE).toBe(next.__PRIVATE_NEXTJS_INTERNALS_TREE);
    expect(sheetMarkerOf(state)).toBe("a-1");
    expect(sheetMarkerOf(next)).toBeNull();
    expect(next).not.toHaveProperty("__sheet");
  });

  it("regge uno stato vuoto o che non è un oggetto", () => {
    expect(withSheetMarker(null, "a-1")).toEqual({ __sheet: "a-1" });
    expect(withSheetMarker(undefined, "a-1")).toEqual({ __sheet: "a-1" });
    expect(withSheetMarker("testo", "a-1")).toEqual({ __sheet: "a-1" });
    expect(sheetMarkerOf(null)).toBeNull();
    expect(sheetMarkerOf(undefined)).toBeNull();
    expect(sheetMarkerOf(7)).toBeNull();
    expect(sheetMarkerOf({ __sheet: 7 })).toBeNull();
    expect(sheetMarkerOf({ __sheet: "" })).toBeNull();
  });

  it("un foglio nuovo prende il posto del segno di prima", () => {
    const state = withSheetMarker(withSheetMarker(next, "a-1"), "a-2");
    expect(sheetMarkerOf(state)).toBe("a-2");
    expect(state.__NA).toBe(true);
  });

  it("riconosce il proprio passo", () => {
    const state = withSheetMarker(next, "a-1");
    expect(isOwnEntry(state, "a-1")).toBe(true);
    expect(isOwnEntry(state, "a-2")).toBe(false);
    expect(isOwnEntry(next, "a-1")).toBe(false);
    expect(isOwnEntry(null, "a-1")).toBe(false);
  });
});

describe("dove il tasto indietro chiude già il dialog", () => {
  const android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const desktop = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

  it("Android con CloseWatcher: nessun passo nella cronologia", () => {
    expect(systemClosesDialogs({ hasCloseWatcher: true, userAgent: android })).toBe(true);
    expect(systemClosesDialogs({ hasCloseWatcher: true, userAgent: desktop, platform: "Android" })).toBe(true);
  });

  it("altrove serve il passo", () => {
    expect(systemClosesDialogs({ hasCloseWatcher: false, userAgent: android })).toBe(false);
    expect(systemClosesDialogs({ hasCloseWatcher: false, userAgent: iphone })).toBe(false);
    // se un giorno CloseWatcher arriva su iPhone, lo scorrimento dal bordo resta un passo di cronologia
    expect(systemClosesDialogs({ hasCloseWatcher: true, userAgent: iphone })).toBe(false);
    // sul computer CloseWatcher risponde solo a Esc
    expect(systemClosesDialogs({ hasCloseWatcher: true, userAgent: desktop, platform: "Windows" })).toBe(false);
  });
});

describe("che cosa fa un «indietro» a foglio aperto", () => {
  it("senza passo interno chiude il foglio", () => {
    expect(backRequest({ hasBack: false, busy: false })).toBe("close");
  });

  it("dentro un passo interno torna al passo prima, e il foglio resta", () => {
    expect(backRequest({ hasBack: true, busy: false })).toBe("back");
    expect(backRequest({ hasBack: true, busy: false, leftPage: false })).toBe("back");
  });

  it("con un'azione in corso non fa niente", () => {
    expect(backRequest({ hasBack: true, busy: true })).toBe("stay");
    expect(backRequest({ hasBack: false, busy: true })).toBe("stay");
  });

  it("se la pagina è stata lasciata il foglio si chiude comunque", () => {
    expect(backRequest({ hasBack: true, busy: false, leftPage: true })).toBe("close");
    expect(backRequest({ hasBack: true, busy: true, leftPage: true })).toBe("close");
    expect(backRequest({ hasBack: false, busy: false, leftPage: true })).toBe("close");
  });

  it("il passo rimesso dopo un «indietro» in un passo interno porta lo stesso segno del foglio", () => {
    const page = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: ["", {}], renderedSearch: "" } };
    const opened = withSheetMarker(page, "a-1");
    // l'«indietro» ha riportato sul passo della pagina: il foglio resta aperto e il suo passo torna in cima
    expect(backRequest({ hasBack: true, busy: false })).not.toBe("close");
    const restored = withSheetMarker(page, "a-1");
    expect(sheetMarkerOf(restored)).toBe(sheetMarkerOf(opened));
    expect(isOwnEntry(restored, "a-1")).toBe(true);
    expect(restored.__PRIVATE_NEXTJS_INTERNALS_TREE).toBe(page.__PRIVATE_NEXTJS_INTERNALS_TREE);
    // rimesso due volte resta un passo solo dello stesso foglio
    expect(withSheetMarker(restored, "a-1")).toEqual(restored);
  });
});

describe("chiudi e poi", () => {
  it("fuori dal browser non fa niente", () => {
    let ran = false;
    closeSheetThen(() => {
      ran = true;
    });
    expect(ran).toBe(false);
  });
});

describe("collegamento interno o esterno", () => {
  it("interni: cominciano con una barra sola", () => {
    expect(isInternalHref("/app")).toBe(true);
    expect(isInternalHref("/app/dispensa?lotto=abc#dati")).toBe(true);
    expect(isInternalHref("/")).toBe(true);
    expect(isInternalHref("  /app/oggi ")).toBe(true);
  });

  it("esterni, ancore e schemi restano al browser", () => {
    expect(isInternalHref("https://example.com/app")).toBe(false);
    expect(isInternalHref("//example.com/app")).toBe(false);
    expect(isInternalHref("/\\example.com")).toBe(false);
    expect(isInternalHref("mailto:a@example.com")).toBe(false);
    expect(isInternalHref("tel:+390000")).toBe(false);
    expect(isInternalHref("#dati")).toBe(false);
    expect(isInternalHref("?lotto=abc")).toBe(false);
    expect(isInternalHref("app/oggi")).toBe(false);
    expect(isInternalHref("")).toBe(false);
    expect(isInternalHref(null)).toBe(false);
    expect(isInternalHref(undefined)).toBe(false);
  });
});
