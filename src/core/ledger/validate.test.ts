import { describe, expect, it } from "vitest";
import { isCalendarDate, isIsoInstant } from "./time";
import {
  adjust,
  consume,
  declare,
  discard,
  move,
  open,
  purchase,
  q,
  updateLot,
  voidOf,
} from "./test-helpers";
import type { Unit } from "./types";
import { validateEvent } from "./validate";

const AT = "2026-03-10T08:00:00.000Z";

const good = purchase("e1", AT, {
  lotId: "L1",
  productRef: "latte",
  quantity: q(1000, "ml"),
  priceCents: 150,
  store: "Coop",
  location: "frigo",
  expiry: { date: "2026-03-20", kind: "use_by" },
});

const paths = (e: unknown, opts?: Parameters<typeof validateEvent>[1]) =>
  validateEvent(e, opts).map((x) => `${x.path}:${x.code}`);

describe("validateEvent", () => {
  it("accetta un evento di ogni tipo ben formato", () => {
    const ok = [
      good,
      declare("e2", AT, { lotId: "L2", productRef: "riso", quantity: q(500), location: "dispensa" }),
      consume("e3", AT, { lotId: "L1", quantity: q(1, "ml"), mealId: "m" }),
      discard("e4", AT, { lotId: "L1", quantity: q(1, "ml"), reason: "leftover" }),
      open("e5", AT, { lotId: "L1" }),
      move("e6", AT, { lotId: "L1", to: "freezer" }),
      adjust("e7", AT, { lotId: "L1", remaining: q(0, "ml") }),
      updateLot("e8", AT, { lotId: "L1", patch: { expiry: null } }),
      voidOf("e9", AT, "e1"),
    ];
    for (const e of ok) expect(validateEvent(e)).toEqual([]);
  });

  it("non lancia su input non oggetto", () => {
    for (const v of [null, undefined, 3, "x", []]) {
      expect(validateEvent(v)).toEqual([{ path: "", code: "not_an_object" }]);
    }
  });

  it("segnala campi comuni mancanti o errati", () => {
    expect(paths({})).toEqual(
      expect.arrayContaining([
        "id:required",
        "at:required",
        "recordedAt:required",
        "deviceId:required",
        "schemaVersion:required",
        "certainty:required",
        "source:required",
        "type:required",
      ]),
    );
    expect(paths({ ...good, schemaVersion: 2, certainty: "boh", source: "x", id: "  " })).toEqual(
      expect.arrayContaining([
        "schemaVersion:invalid_value",
        "certainty:invalid_value",
        "source:invalid_value",
        "id:invalid_type",
      ]),
    );
    expect(paths({ ...good, type: "teleport" })).toEqual(["type:invalid_value"]);
  });

  it("segnala campi specifici mancanti", () => {
    const { lotId: _l, productRef: _p, location: _loc, quantity: _q, ...rest } = good;
    void [_l, _p, _loc, _q];
    expect(paths(rest)).toEqual(
      expect.arrayContaining([
        "lotId:required",
        "productRef:required",
        "location:required",
        "quantity:required",
      ]),
    );
    expect(paths({ ...consume("c", AT, { lotId: "L", quantity: q(1) }), lotId: undefined })).toEqual([
      "lotId:required",
    ]);
    expect(paths({ ...discard("d", AT, { lotId: "L", quantity: q(1), reason: "other" }), reason: "x" })).toEqual([
      "reason:invalid_value",
    ]);
    expect(paths({ ...move("m", AT, { lotId: "L", to: "freezer" }), to: "cantina" })).toEqual([
      "to:invalid_value",
    ]);
    expect(paths({ ...voidOf("v", AT, "x"), targetEventId: "" })).toEqual([
      "targetEventId:invalid_type",
    ]);
  });

  it("rifiuta quantità non positive, non finite o con unità errata", () => {
    const withQ = (quantity: unknown) => paths({ ...good, quantity });
    expect(withQ({ value: 0, unit: "g" })).toEqual(["quantity.value:not_positive"]);
    expect(withQ({ value: -3, unit: "g" })).toEqual(["quantity.value:not_positive"]);
    expect(withQ({ value: Number.NaN, unit: "g" })).toEqual(["quantity.value:invalid_value"]);
    expect(withQ({ value: Infinity, unit: "g" })).toEqual(["quantity.value:invalid_value"]);
    expect(withQ({ value: "5", unit: "g" })).toEqual(["quantity.value:invalid_value"]);
    expect(withQ({ value: 5, unit: "kg" })).toEqual(["quantity.unit:invalid_value"]);
    expect(withQ({ value: 5 })).toEqual(["quantity.unit:required"]);
    expect(withQ("5g")).toEqual(["quantity:invalid_type"]);
  });

  it("adjust ammette zero ma non valori negativi", () => {
    const withR = (value: number) =>
      paths(adjust("a", AT, { lotId: "L", remaining: { value, unit: "g" } }));
    expect(withR(0)).toEqual([]);
    expect(withR(-1)).toEqual(["remaining.value:negative"]);
  });

  it("unità diversa da quella del lotto, quando nota", () => {
    const lotUnits = new Map<string, Unit>([["L1", "ml"]]);
    const c = consume("c", AT, { lotId: "L1", quantity: q(5, "g") });
    expect(paths(c)).toEqual([]);
    expect(paths(c, { lotUnits })).toEqual(["quantity.unit:unit_mismatch"]);
    expect(paths(consume("c", AT, { lotId: "L1", quantity: q(5, "ml") }), { lotUnits })).toEqual([]);
    expect(paths(consume("c", AT, { lotId: "ALTRO", quantity: q(5, "g") }), { lotUnits })).toEqual([]);
    expect(
      paths(adjust("a", AT, { lotId: "L1", remaining: q(1, "pz") }), { lotUnits }),
    ).toEqual(["remaining.unit:unit_mismatch"]);
  });

  it("date e istanti malformati", () => {
    expect(paths({ ...good, at: "2026-03-10 08:00" })).toEqual(["at:invalid_instant"]);
    expect(paths({ ...good, at: "2026-03-10T08:00:00+01:00" })).toEqual(["at:invalid_instant"]);
    expect(paths({ ...good, recordedAt: "2026-02-30T08:00:00.000Z" })).toEqual([
      "recordedAt:invalid_instant",
    ]);
    expect(paths({ ...good, expiry: { date: "2026-02-30", kind: "use_by" } })).toEqual([
      "expiry.date:invalid_date",
    ]);
    expect(paths({ ...good, expiry: { date: "20/03/2026", kind: "use_by" } })).toEqual([
      "expiry.date:invalid_date",
    ]);
    expect(paths({ ...good, expiry: { date: "2026-03-20", kind: "never" } })).toEqual([
      "expiry.kind:invalid_value",
    ]);
  });

  it("prezzo in centesimi interi non negativi", () => {
    expect(paths({ ...good, priceCents: 1.5 })).toEqual(["priceCents:invalid_value"]);
    expect(paths({ ...good, priceCents: -1 })).toEqual(["priceCents:invalid_value"]);
    expect(paths({ ...good, priceCents: "3" })).toEqual(["priceCents:invalid_type"]);
    expect(paths({ ...good, priceCents: 0 })).toEqual([]);
  });

  it("declare non ammette prezzo né negozio", () => {
    const d = declare("d", AT, { lotId: "L", productRef: "x", quantity: q(1), location: "frigo" });
    expect(paths({ ...d, priceCents: 100, store: "Coop" })).toEqual([
      "priceCents:not_allowed",
      "store:not_allowed",
    ]);
  });

  it("patch di updateLot", () => {
    const u = (patch: unknown) => paths({ ...updateLot("u", AT, { lotId: "L", patch: {} }), patch });
    expect(u({})).toEqual(["patch:empty_patch"]);
    expect(u(undefined)).toEqual(["patch:required"]);
    expect(u("x")).toEqual(["patch:invalid_type"]);
    expect(u({ expiry: { date: "2026-13-01", kind: "use_by" } })).toEqual([
      "patch.expiry.date:invalid_date",
    ]);
    expect(u({ priceCents: -2 })).toEqual(["patch.priceCents:invalid_value"]);
    expect(u({ productRef: "" })).toEqual(["patch.productRef:invalid_type"]);
    expect(u({ store: null, priceCents: null, expiry: null })).toEqual([]);
  });
});

describe("time helpers", () => {
  it("isCalendarDate gestisce anni bisestili", () => {
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2027-02-29")).toBe(false);
    expect(isCalendarDate("2100-02-29")).toBe(false);
    expect(isCalendarDate("2026-04-31")).toBe(false);
  });

  it("isIsoInstant accetta solo UTC con Z", () => {
    expect(isIsoInstant("2026-03-10T08:00:00Z")).toBe(true);
    expect(isIsoInstant("2026-03-10T08:00:00.123Z")).toBe(true);
    expect(isIsoInstant("2026-03-10T24:00:00.000Z")).toBe(false);
    expect(isIsoInstant("2026-03-10T08:00:00.1Z")).toBe(false);
  });
});
