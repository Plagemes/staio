import { describe, expect, it } from "vitest";
import { wantsAddSheet, withoutAddParam } from "./addParam";

describe("wantsAddSheet", () => {
  it("è vero solo per aggiungi=1", () => {
    expect(wantsAddSheet("")).toBe(false);
    expect(wantsAddSheet("?")).toBe(false);
    expect(wantsAddSheet("?aggiungi=1")).toBe(true);
    expect(wantsAddSheet("?giorno=2026-11-14&aggiungi=1")).toBe(true);
    expect(wantsAddSheet("?aggiungi=0")).toBe(false);
    expect(wantsAddSheet("?aggiungi")).toBe(false);
    expect(wantsAddSheet("?aggiungi=10")).toBe(false);
    expect(wantsAddSheet("?aggiungi=0&aggiungi=1")).toBe(true);
  });
});

describe("withoutAddParam", () => {
  it("senza parametri lascia l'indirizzo", () => {
    expect(withoutAddParam("/app", "", "")).toBe("/app");
  });
  it("toglie il solo parametro", () => {
    expect(withoutAddParam("/app", "?aggiungi=1", "")).toBe("/app");
  });
  it("tiene gli altri nell'ordine e il frammento", () => {
    expect(withoutAddParam("/app", "?a=1&aggiungi=1&giorno=2026-11-14", "#x")).toBe("/app?a=1&giorno=2026-11-14#x");
  });
  it("toglie anche aggiungi=0 e i valori ripetuti", () => {
    expect(withoutAddParam("/app", "?aggiungi=0&b=2&aggiungi=1", "")).toBe("/app?b=2");
  });
});
