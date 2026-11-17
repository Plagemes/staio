import { describe, expect, it } from "vitest";
import { purchase } from "@/core/diary/test-helpers";
import type { AnyEvent } from "@/core/events";
import { derivePantry, type PurchaseEvent } from "@/core/ledger";
import { buildAttachCode } from "./actions";
import { localCodeForName } from "./capture/localProduct";

const at = "2026-11-10T08:00:00.000Z";
const make = (id: string, lotId: string) => purchase(id, at, { lotId, productRef: "Biscotti", quantity: { value: 500, unit: "g" }, location: "dispensa" }) as PurchaseEvent;
const a = make("pa", "lot-a");
const b = make("pb", "lot-b");
const log: AnyEvent[] = [a, b];
const lots = derivePantry(log).lots;
const lotOf = (id: string) => lots.find((l) => l.lotId === id)!;
const ctx = { now: "2026-11-16T10:00:00.000Z", deviceId: "dev-a" };

describe("valori scritti a mano: a quali confezioni va il codice", () => {
  it("solo alla confezione aperta: l'altra con lo stesso nome non cambia", () => {
    const code = localCodeForName("Biscotti") as string;
    const r = buildAttachCode([{ lot: lotOf("lot-a"), creation: a }], code, ctx);
    if (!r.ok) throw new Error("atteso ok");
    const after = derivePantry([...log, ...r.events]).lots;
    expect(after.find((l) => l.lotId === "lot-a")?.barcode).toBe(code);
    expect(after.find((l) => l.lotId === "lot-b")?.barcode).toBeUndefined();
  });

  it("alle altre solo se sono nell'elenco passato; la variante due dà un altro codice", () => {
    const first = localCodeForName("Biscotti") as string;
    const second = localCodeForName("Biscotti", 1) as string;
    expect(second).not.toBe(first);
    const r = buildAttachCode([{ lot: lotOf("lot-a"), creation: a }, { lot: lotOf("lot-b"), creation: b }], second, ctx);
    if (!r.ok) throw new Error("atteso ok");
    expect(derivePantry([...log, ...r.events]).lots.map((l) => l.barcode)).toEqual([second, second]);
  });
});
