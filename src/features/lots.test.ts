import { describe, expect, it } from "vitest";
import { derivePantry, type LedgerEvent, type Lot } from "@/core/ledger";
import { buildMove, buildOpen } from "./actions";
import { buildCaptureEvents, type CaptureInput } from "./capture";
import {
  evaluateLots,
  expiryExplanation,
  expiryTagView,
  levelPercent,
  lotToExpiryItem,
  previewExpiryAfterMove,
} from "./lots";

const NOW = "2026-11-16T10:00:00.000Z";
const base: CaptureInput = {
  name: "Petto di pollo",
  quantityText: "400 g",
  location: "frigo",
  category: "poultry",
  expiryKind: "use_by",
  expiryDate: "2026-11-17",
  priceText: "",
  alreadyHave: false,
};

function add(over: Partial<CaptureInput>, now = NOW): LedgerEvent[] {
  const r = buildCaptureEvents({ ...base, ...over }, { now, deviceId: "d" });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.events;
}
const lotsOf = (events: LedgerEvent[]): Lot[] => derivePantry(events).lots;

describe("lotToExpiryItem", () => {
  it("mappa data in etichetta, luogo e categoria", () => {
    const [lot] = lotsOf(add({}));
    expect(lotToExpiryItem(lot)).toMatchObject({
      labelDateType: "use_by",
      labelDate: "2026-11-17",
      purchaseDate: "2026-11-16",
      location: "frigo",
      category: "poultry",
      openedDate: null,
    });
  });

  it("senza data: tipo none; senza categoria: nessuna voce", () => {
    const [none] = lotsOf(add({ expiryKind: "none", expiryDate: "" }));
    expect(lotToExpiryItem(none)?.labelDateType).toBe("none");
    expect(lotToExpiryItem({ ...none, category: undefined })).toBeNull();
    expect(lotToExpiryItem({ ...none, category: "boh" })).toBeNull();
  });
});

describe("evaluateLots", () => {
  it("ordina da mangiare prima e segna le stime", () => {
    const events = [
      ...add({ name: "Riso", quantityText: "1 kg", category: "rice_cereals", location: "dispensa", expiryKind: "none", expiryDate: "" }),
      ...add({ name: "Pollo" }),
      ...add({ name: "Yogurt", category: "yogurt", expiryKind: "none", expiryDate: "" }),
    ];
    const entries = evaluateLots(lotsOf(events), NOW);
    expect(entries.map((e) => e.lot.productRef)).toEqual(["Pollo", "Yogurt", "Riso"]);
    const [pollo, yogurt] = entries.map(expiryTagView);
    expect(pollo).toMatchObject({ level: "urgent", text: "domani", estimated: false });
    expect(yogurt).toMatchObject({ estimated: true });
  });

  it("i lotti senza categoria seguono gli altri, con la sola data in etichetta", () => {
    const [lot] = lotsOf(add({}));
    const orphan: Lot = { ...lot, lotId: "x", productRef: "Misterioso", category: undefined };
    const [first, second] = evaluateLots([orphan, lot], NOW);
    expect(first.lot.lotId).toBe(lot.lotId);
    expect(second.lot.productRef).toBe("Misterioso");
    expect(second.urgency?.level).toBe("tomorrow");
    expect(second.expiry?.certainty).toBe("label");
  });

  it("un lotto senza categoria e senza data non ha scadenza", () => {
    const [lot] = lotsOf(add({ expiryKind: "none", expiryDate: "" }));
    const [e] = evaluateLots([{ ...lot, category: undefined }], NOW);
    expect(e.expiry).toBeUndefined();
    expect(expiryTagView(e)).toBeUndefined();
    expect(expiryExplanation(e)).toMatch(/Nessuna scadenza/);
  });

  it("l'apertura accorcia la scadenza stimata", () => {
    const created = add({ name: "Latte", category: "milk_uht", expiryKind: "none", expiryDate: "" });
    const [before] = evaluateLots(lotsOf(created), NOW);
    const [lot] = lotsOf(created);
    const open = buildOpen(lot, { now: NOW, deviceId: "d" });
    if (!open.ok) throw new Error("apertura");
    const [after] = evaluateLots(lotsOf([...created, ...open.events]), NOW);
    expect(after.expiry?.basis).toBe("opened");
    expect(after.expiry!.date < before.expiry!.date).toBe(true);
  });
});

describe("spostamento in freezer", () => {
  it("il freezer ricalcola la scadenza dal giorno dello spostamento", () => {
    const created = add({ expiryKind: "none", expiryDate: "" });
    const [lot] = lotsOf(created);
    const [before] = evaluateLots([lot], NOW);
    expect(before.expiry?.basis).toBe("estimated");

    const preview = previewExpiryAfterMove(lot, "freezer", NOW);
    expect(preview?.expiry).toMatchObject({ basis: "frozen", date: "2027-08-16", certainty: "estimated" });

    const moved = buildMove(lot, "freezer", { now: NOW, deviceId: "d" });
    if (!moved.ok) throw new Error("spostamento");
    const [real] = evaluateLots(lotsOf([...created, ...moved.events]), NOW);
    expect(real.expiry).toEqual(preview?.expiry);
  });

  it("uscire dal freezer dà una scadenza breve dopo lo scongelamento", () => {
    const created = add({ location: "freezer", expiryKind: "none", expiryDate: "" });
    const [lot] = lotsOf(created);
    const out = previewExpiryAfterMove(lot, "frigo", NOW);
    expect(out?.expiry).toMatchObject({ basis: "thawed", date: "2026-11-17", nature: "safety" });
  });

  it("stesso luogo: nessuna anteprima e l'azione è rifiutata", () => {
    const [lot] = lotsOf(add({}));
    expect(previewExpiryAfterMove(lot, "frigo", NOW)).toBeUndefined();
    expect(buildMove(lot, "frigo", { now: NOW, deviceId: "d" }).ok).toBe(false);
  });
});

describe("levelPercent", () => {
  it("rimasto rispetto all'iniziale", () => {
    const [lot] = lotsOf(add({}));
    expect(levelPercent(lot)).toBe(100);
    expect(levelPercent({ ...lot, remaining: 100 })).toBe(25);
    expect(levelPercent({ ...lot, initial: 0 })).toBe(0);
  });
});
