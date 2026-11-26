import { describe, expect, it } from "vitest";
import { derivePantry, estimatedPantryValue, pantryValueParts } from "@/core/ledger";
import { consume, declare, purchase, q } from "@/core/ledger/test-helpers";
import { pantryValueContent } from "./valueBreakdown";

const NOW = "2026-03-20T09:00:00.000Z";
const D = (day: number, month = 3) => `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T10:00:00.000Z`;

const num = (s: string) => Number(s.replace(/[^\d,]/g, "").replace(",", "."));

const state = derivePantry([
  purchase("p1", D(12), { lotId: "L1", productRef: "Latte intero", quantity: q(1000, "ml"), priceCents: 189, location: "frigo" }),
  purchase("p2", D(2), { lotId: "L2", productRef: "Pane", quantity: q(500), priceCents: 333, location: "dispensa", certainty: "estimated" }),
  purchase("p3", D(3), { lotId: "L3", productRef: "Uova", quantity: q(6, "pz"), location: "frigo" }),
  purchase("p4", D(3), { lotId: "L4", productRef: "Uova", quantity: q(6, "pz"), location: "frigo" }),
  declare("p5", D(3), { lotId: "L5", productRef: "Riso", quantity: q(1000), location: "dispensa" }),
  purchase("p6", D(4), { lotId: "L6", productRef: "Piselli", quantity: q(400), priceCents: 301, location: "freezer" }),
  purchase("p7", D(5), { lotId: "L7", productRef: "Pasta", quantity: q(500), priceCents: 200, location: "dispensa" }),
  consume("c1", D(13), { lotId: "L7", quantity: q(250) }),
  consume("c2", D(13), { lotId: "L1", quantity: q(600, "ml") }),
]);

const content = pantryValueContent(pantryValueParts(state), NOW);

describe("il foglio «Valore della dispensa»", () => {
  it("le righe a schermo fanno il totale a schermo (interi, senza ripartire)", () => {
    const sum = content.rows.reduce((s, r) => s + Math.round(num(r.value) * 100), 0);
    expect(sum).toBe(Math.round(num(content.total) * 100));
    expect(Math.round(num(content.total) * 100)).toBe(estimatedPantryValue(state).cents);
  });

  it("con lotti senza prezzo dice «almeno» e li raggruppa per nome", () => {
    expect(content.totalPrefix).toBe("almeno");
    expect(content.missingLabel).toBe("Senza prezzo (3)");
    expect(content.missing?.map((r) => r.label)).toEqual(["Uova (2)", "Riso"]);
    expect(content.missing?.[1].href).toBe("/app/dispensa?lotto=L5");
    expect(content.missing?.[0].href).toBeUndefined();
    expect(content.note).toBe('Gli alimenti segnati come "già in casa" non hanno un prezzo.');
  });

  it("senza lotti senza prezzo non c'è «almeno» né nota", () => {
    const only = derivePantry([purchase("p1", D(12), { lotId: "L1", productRef: "Pane", quantity: q(500), priceCents: 250, location: "dispensa" })]);
    const c = pantryValueContent(pantryValueParts(only), NOW);
    expect(c.totalPrefix).toBeUndefined();
    expect(c.missing).toBeUndefined();
    expect(c.note).toBeUndefined();
    expect(c.total).toBe("2,50 €");
  });

  it("righe nell'ordine dei luoghi, dentro il luogo dal più grande, con la parte che resta", () => {
    expect(content.rows.map((r) => r.id)).toEqual(["L1", "L6", "L2", "L7"]);
    expect(content.rows[0]).toMatchObject({ label: "Latte intero · resta il 40%", value: "0,76 €", hint: "Frigo · pagato 1,89 € il 12 mar", href: "/app/dispensa?lotto=L1" });
    expect(content.rows[1].label).toBe("Piselli"); // intero: senza «resta»
    expect(content.rows[3]).toMatchObject({ label: "Pasta · resta il 50%", value: "1,00 €" });
  });

  it("titolo, introduzione e certezza peggiore", () => {
    expect(content.title).toBe("Valore della dispensa");
    expect(content.lead).toBe("Tutta la dispensa, anche ciò che non vedi con i filtri. Per ogni alimento conta il prezzo pagato per la parte che resta.");
    expect(content.totalCertainty).toBe("estimated");
  });

  it("l'anno si dice solo se è diverso da quello di oggi", () => {
    const old = derivePantry([purchase("p1", "2025-11-12T10:00:00.000Z", { lotId: "L1", productRef: "Miele", quantity: q(500), priceCents: 500, location: "dispensa" })]);
    expect(pantryValueContent(pantryValueParts(old), NOW).rows[0].hint).toBe("Credenza · pagato 5,00 € il 12 nov 2025");
  });
});
