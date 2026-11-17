import { describe, expect, it } from "vitest";
import type { AnyEvent } from "@/core/events";
import { derivePantry } from "@/core/ledger";
import { buildUndo } from "./actions";
import { buildCaptureEvents } from "./capture";
import { buildJournal } from "./journal";

const NOW = "2026-11-16T10:00:00.000Z"; // 11:00 a Roma

function add(name: string, quantityText: string, now = NOW): AnyEvent[] {
  const r = buildCaptureEvents(
    { name, quantityText, location: "frigo", category: "milk_fresh", expiryKind: "none", expiryDate: "", priceText: "", alreadyHave: false },
    { now, deviceId: "d" },
  );
  if (!r.ok) throw new Error("setup");
  return r.events;
}

const rowsOf = (events: AnyEvent[]) => buildJournal(events, derivePantry(events.filter((e) => e.type !== "meal")), "2026-11-16");

describe("registro di oggi: righe uguali", () => {
  it("tre ingressi uguali alla stessa ora fanno una riga con il numero", () => {
    const events = [...add("Mousse cacao protein", "170 g"), ...add("Mousse cacao protein", "170 g"), ...add("Mousse cacao protein", "170 g")];
    const rows = rowsOf(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ time: "11:00", description: "Entra · Mousse cacao protein · 3 × 170 g", value: "510 g", canUndo: true });
    expect(rows[0].ids).toHaveLength(3);
  });

  it("quantità diverse o minuti diversi restano righe distinte", () => {
    const events = [
      ...add("Mousse cacao protein", "170 g"),
      ...add("Mousse cacao protein", "200 g"),
      ...add("Mousse cacao protein", "170 g", "2026-11-16T10:05:00.000Z"),
    ];
    expect(rowsOf(events).map((r) => r.description)).toEqual([
      "Entra · Mousse cacao protein",
      "Entra · Mousse cacao protein",
      "Entra · Mousse cacao protein",
    ]);
  });

  it("una riga sola non cambia, e annullare la riga unita annulla tutti i suoi eventi", () => {
    const events = [...add("Yogurt", "125 g"), ...add("Yogurt", "125 g")];
    const [row] = rowsOf(events);
    expect(row.description).toBe("Entra · Yogurt · 2 × 125 g");
    const targets = events.filter((e) => row.ids.includes(e.id));
    const after = [...events, ...buildUndo(targets, { now: "2026-11-16T10:01:00.000Z", deviceId: "d" })];
    expect(rowsOf(after)).toEqual([]);
    expect(rowsOf(add("Yogurt", "125 g"))[0].description).toBe("Entra · Yogurt");
  });
});

describe("registro di oggi: consumi dentro un pasto", () => {
  const withConsume = (note?: string): AnyEvent[] => {
    const entry = add("Petto di pollo", "1 kg");
    const lotId = (entry[0] as { lotId: string }).lotId;
    const eaten = {
      id: "c1", type: "consume", at: "2026-11-16T12:11:00.000Z", recordedAt: "2026-11-16T12:11:00.000Z", deviceId: "d", schemaVersion: 1,
      certainty: "measured", source: "manual", lotId, quantity: { value: 275, unit: "g" }, mealId: "meal-1", ...(note ? { note } : {}),
    } as AnyEvent;
    return [...entry, eaten];
  };

  it("un consumo di un pasto non si toglie dal registro: si dice dove", () => {
    const row = rowsOf(withConsume()).find((r) => r.description.startsWith("Mangiato"));
    expect(row?.canUndo).toBe(false);
    expect(row?.undoBlocked).toMatch(/Fa parte di un pasto/);
    expect(row?.undoBlocked).toMatch(/«Diario di oggi»/);
  });

  it("uno nato dal tocco sulla scheda manda a «Diario di oggi», dove si sposta o si toglie", () => {
    const row = rowsOf(withConsume("quick")).find((r) => r.description.startsWith("Mangiato"));
    expect(row?.undoBlocked).toMatch(/momento in cui l'hai segnato/);
    expect(row?.undoBlocked).toMatch(/«Diario di oggi»/);
  });

  it("nessun motivo cita più «Momenti di oggi»", () => {
    for (const row of [...rowsOf(withConsume()), ...rowsOf(withConsume("quick"))]) expect(row.undoBlocked ?? "").not.toMatch(/Momenti di oggi/);
  });
});

describe("la riga «Dispensa» del diario: senza i consumi dei pasti", () => {
  // quantità diverse: righe uguali alla stessa ora si unirebbero in una
  const consume = (id: string, lotId: string, grams: number, extra: Record<string, unknown> = {}): AnyEvent =>
    ({
      id, type: "consume", at: "2026-11-16T12:11:00.000Z", recordedAt: "2026-11-16T12:11:00.000Z", deviceId: "d", schemaVersion: 1,
      certainty: "measured", source: "manual", lotId, quantity: { value: grams, unit: "g" }, ...extra,
    }) as AnyEvent;
  const entry = add("Petto di pollo", "1 kg");
  const lotId = (entry[0] as { lotId: string }).lotId;
  const events = [
    ...entry,
    consume("in-meal", lotId, 100, { mealId: "meal-1" }),
    consume("quick", lotId, 150, { mealId: "meal-2", note: "quick" }),
    consume("alone", lotId, 200),
  ];
  const pantry = derivePantry(events);

  it("con l'opzione restano fuori i consumi con un pasto; gli altri movimenti restano", () => {
    const rows = buildJournal(events, pantry, "2026-11-16", undefined, { withoutMealConsumes: true });
    expect(rows.map((r) => r.description)).toEqual(["Entra · Petto di pollo", "Mangiato · Petto di pollo"]);
    expect(rows.flatMap((r) => r.ids)).toEqual([entry[0].id, "alone"]);
    expect(rows[1].canUndo).toBe(true);
  });

  it("senza l'opzione tutto come prima: i consumi dei pasti ci sono, e dicono dove si tolgono", () => {
    const plain = buildJournal(events, pantry, "2026-11-16");
    expect(buildJournal(events, pantry, "2026-11-16", undefined, {})).toEqual(plain);
    expect(buildJournal(events, pantry, "2026-11-16", undefined, { withoutMealConsumes: false })).toEqual(plain);
    expect(plain.flatMap((r) => r.ids).sort()).toEqual([entry[0].id, "alone", "in-meal", "quick"].sort());
    expect(plain.filter((r) => !r.canUndo).flatMap((r) => r.ids).sort()).toEqual([entry[0].id, "in-meal", "quick"].sort());
  });
});
