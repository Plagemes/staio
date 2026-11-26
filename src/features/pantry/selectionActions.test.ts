import { describe, expect, it } from "vitest";
import { activeLots, derivePantry, type LedgerEvent, type Location, type Lot } from "@/core/ledger";
import { buildUndo, type ActionContext } from "../actions";
import { buildCaptureEvents } from "../capture";
import {
  buildMoveSelection,
  listMessage,
  moveMessage,
  nothingToMoveText,
  planList,
  planMove,
  selectionExtras,
  shoppingNames,
} from "./selectionActions";

const NOW = "2026-11-16T10:00:00.000Z";
const ctx: ActionContext = { now: "2026-11-16T12:00:00.000Z", deviceId: "d" };

function buy(name: string, location: Location, quantityText = "1 l"): LedgerEvent[] {
  const r = buildCaptureEvents(
    { name, quantityText, location, category: "milk_fresh", expiryKind: "use_by", expiryDate: "2026-11-30", priceText: "", alreadyHave: false },
    { now: NOW, deviceId: "d" },
  );
  if (!r.ok) throw new Error("setup");
  return r.events;
}

function pantryOf(...groups: LedgerEvent[][]): { events: LedgerEvent[]; lots: Lot[] } {
  const events = groups.flat();
  return { events, lots: activeLots(derivePantry(events)) };
}

describe("planMove", () => {
  it("lascia dove sono le confezioni già nel luogo e conta quelle che non ci sono più", () => {
    const { lots } = pantryOf(buy("Latte", "frigo"), buy("Pane", "freezer"), buy("Burro", "frigo"));
    const [latte, pane, burro] = lots;
    const plan = planMove(lots, [latte.lotId, pane.lotId, "finito"], "freezer");
    expect(plan.toMove.map((l) => l.lotId)).toEqual([latte.lotId]);
    expect(plan.alreadyThere).toBe(1);
    expect(plan.gone).toBe(1);
    expect(plan.toMove).not.toContain(burro);
  });

  it("non sposta una confezione finita nel frattempo", () => {
    const { lots } = pantryOf(buy("Latte", "frigo"));
    const plan = planMove([], [lots[0].lotId], "freezer");
    expect(plan).toEqual({ toMove: [], alreadyThere: 0, gone: 1 });
  });
});

describe("buildMoveSelection", () => {
  it("scrive un move per confezione, tutti verso il luogo scelto, e l'annulla li rimette tutti", () => {
    const { events, lots } = pantryOf(buy("Latte", "frigo"), buy("Pane", "dispensa"), buy("Burro", "freezer"));
    const plan = planMove(lots, lots.map((l) => l.lotId), "freezer");
    const r = buildMoveSelection(plan, "freezer", ctx);
    if (!r.ok) throw new Error(r.error);
    expect(r.events.map((e) => e.type)).toEqual(["move", "move"]);
    expect(r.events.every((e) => e.type === "move" && e.to === "freezer")).toBe(true);
    expect(r.message).toBe("Spostate in freezer: 2 confezioni. 1 era già in freezer.");

    const after = derivePantry([...events, ...r.events]);
    expect(activeLots(after).map((l) => l.location)).toEqual(["freezer", "freezer", "freezer"]);
    const undone = derivePantry([...events, ...r.events, ...buildUndo(r.events, ctx)]);
    expect(activeLots(undone).map((l) => l.location)).toEqual(["frigo", "dispensa", "freezer"]);
  });

  it("una confezione: il testo di un solo spostamento", () => {
    const { lots } = pantryOf(buy("Latte intero", "frigo"));
    const r = buildMoveSelection(planMove(lots, [lots[0].lotId], "freezer"), "freezer", ctx);
    expect(r.ok && r.message).toBe("Spostato in freezer: Latte intero.");
  });

  it("se sono già tutte nel luogo non scrive niente e lo dice", () => {
    const { lots } = pantryOf(buy("Latte", "freezer"), buy("Pane", "freezer"));
    const plan = planMove(lots, lots.map((l) => l.lotId), "freezer");
    expect(buildMoveSelection(plan, "freezer", ctx)).toEqual({ ok: false, error: "Sono già tutti in freezer." });
  });
});

describe("testi", () => {
  it("le note in coda", () => {
    expect(selectionExtras(2, 0, "freezer")).toBe("2 erano già in freezer.");
    expect(selectionExtras(0, 1)).toBe("1 non c'era più.");
    expect(selectionExtras(1, 2, "frigo")).toBe("1 era già in frigo. 2 non c'erano più.");
    expect(selectionExtras(0, 0, "frigo")).toBe("");
  });

  it("l'avviso dello spostamento", () => {
    expect(moveMessage(3, "Latte", "freezer", 0, 0)).toBe("Spostate in freezer: 3 confezioni.");
    expect(moveMessage(1, "Latte", "frigo", 0, 1)).toBe("Spostato in frigo: Latte. 1 non c'era più.");
  });

  it("quando non c'è niente da spostare", () => {
    expect(nothingToMoveText({ toMove: [], alreadyThere: 1, gone: 0 }, "freezer")).toBe("È già in freezer.");
    expect(nothingToMoveText({ toMove: [], alreadyThere: 0, gone: 2 }, "freezer")).toBe("Non ci sono più.");
    expect(nothingToMoveText({ toMove: [], alreadyThere: 1, gone: 1 }, "freezer")).toBe("Sono già in freezer o non ci sono più.");
  });
});

describe("spesa", () => {
  it("un nome per prodotto, senza doppioni tra confezioni", () => {
    const { lots } = pantryOf(buy("Latte", "frigo"), buy("Pane", "dispensa"), buy("latte ", "frigo"));
    expect(shoppingNames(lots)).toEqual(["Latte", "Pane"]);
  });

  it("l'avviso con i nomi", () => {
    expect(listMessage(["Latte", "Pane"], 0)).toBe("Aggiunto alla lista della spesa: latte, pane.");
    expect(listMessage(["Latte", "Pane", "Uova", "Olio", "Sale", "Tè"], 1)).toBe(
      "Aggiunto alla lista della spesa: latte, pane, uova, olio e altri 2. 1 non c'era più.",
    );
  });

  it("le confezioni finite nel frattempo escono dalla scelta", () => {
    const { lots } = pantryOf(buy("Latte", "frigo"), buy("Pane", "dispensa"));
    const plan = planList([lots[1]], [lots[0].lotId, lots[1].lotId]);
    expect(plan.lots).toEqual([lots[1]]);
    expect(plan.gone).toBe(1);
  });
});
