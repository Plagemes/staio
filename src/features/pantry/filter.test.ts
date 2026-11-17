import { describe, expect, it } from "vitest";
import { activeLots, derivePantry } from "@/core/ledger";
import { buildCaptureEvents } from "../capture";
import { evaluateLots } from "../lots";
import { filterEntries, normalizeSearch, splitByExpiry } from "./filter";
import { groupEntries } from "./groups";

const NOW = "2026-11-17T08:00:00.000Z";

function add(name: string, over: Record<string, unknown> = {}) {
  const r = buildCaptureEvents(
    {
      name,
      quantityText: "125 g",
      location: "frigo",
      category: "yogurt",
      expiryKind: "best_before",
      expiryDate: "2026-12-20",
      priceText: "",
      alreadyHave: false,
      ...over,
    },
    { now: NOW, deviceId: "d" },
  );
  if (!r.ok) throw new Error("setup");
  return r.events;
}

const entriesOf = (...batches: ReturnType<typeof add>[]) => evaluateLots(activeLots(derivePantry(batches.flat())), NOW);
const names = (entries: { lot: { productRef: string } }[]) => entries.map((e) => e.lot.productRef);

describe("normalizeSearch", () => {
  it("toglie accenti e maiuscole e riduce gli spazi", () => {
    expect(normalizeSearch("  LATTÉ   Intero ")).toBe("latte intero");
  });
});

describe("filterEntries", () => {
  const entries = entriesOf(add("Latte intero"), add("Petto di pollo"), add("Uova"));

  it("trova senza badare ad accenti e maiuscole", () => {
    expect(names(filterEntries(entries, "latté"))).toEqual(["Latte intero"]);
    expect(names(filterEntries(entries, "UOVA"))).toEqual(["Uova"]);
  });

  it("trova per parole in qualunque ordine", () => {
    expect(names(filterEntries(entries, "pollo petto"))).toEqual(["Petto di pollo"]);
  });

  it("non conta gli spazi in testa, in coda o doppi", () => {
    expect(names(filterEntries(entries, "   pollo    petto  "))).toEqual(["Petto di pollo"]);
  });

  it("con il testo vuoto passano tutte, nello stesso ordine", () => {
    expect(filterEntries(entries, "")).toEqual(entries);
    expect(filterEntries(entries, "   ")).toEqual(entries);
  });

  it("senza corrispondenze non passa niente", () => {
    expect(filterEntries(entries, "pane")).toEqual([]);
  });
});

describe("splitByExpiry", () => {
  it("divide in «in scadenza» e «il resto» contando le righe, non le confezioni", () => {
    const entries = entriesOf(
      add("Latte intero", { expiryDate: "2026-11-18" }),
      add("Budino", { expiryDate: "2026-11-18", barcode: "8076800195057" }),
      add("Budino", { expiryDate: "2026-11-18", barcode: "8076800195057" }),
      add("Yogurt", { expiryDate: "2026-12-20" }),
      add("Uova", { expiryDate: "2026-12-25" }),
    );
    const { expiring, rest } = splitByExpiry(groupEntries(entries));
    expect(expiring).toHaveLength(2);
    expect(rest).toHaveLength(2);
    expect(expiring.flatMap((g) => g.entries)).toHaveLength(3);
  });

  it("non c'è niente in scadenza: un gruppo solo", () => {
    const { expiring, rest } = splitByExpiry(groupEntries(entriesOf(add("Yogurt"), add("Uova"))));
    expect(expiring).toEqual([]);
    expect(rest).toHaveLength(2);
  });

  it("sono tutte in scadenza: il resto è vuoto", () => {
    const { expiring, rest } = splitByExpiry(
      groupEntries(entriesOf(add("Latte intero", { expiryDate: "2026-11-17" }), add("Yogurt", { expiryDate: "2026-11-19" }))),
    );
    expect(expiring).toHaveLength(2);
    expect(rest).toEqual([]);
  });

  it("tiene l'ordine di arrivo dentro ogni gruppo", () => {
    const entries = entriesOf(add("A", { expiryDate: "2026-11-19" }), add("B", { expiryDate: "2026-11-18" }), add("C", { expiryDate: "2026-12-30" }));
    const { expiring, rest } = splitByExpiry(groupEntries(entries));
    expect(expiring.map((g) => g.entries[0].lot.productRef)).toEqual(["B", "A"]);
    expect(rest.map((g) => g.entries[0].lot.productRef)).toEqual(["C"]);
  });
});
