import { describe, expect, it } from "vitest";
import { deriveDiary } from "../diary";
import { derivePantry } from "../ledger";
import { derivePlan } from "../plan";
import { derivePreps } from "../prep";
import { deriveRecipes } from "../recipes";
import { EVENT_FAMILIES, OPERATION_ID_MAX_LENGTH, familyOf, mergeAllEvents, operationIdOf, validateAnyEvent, withOperationId, type AnyEvent } from "./index";
import { stampOperationId } from "./operation";
import { mixedLog } from "./test-helpers";

const log = mixedLog();

describe("opId: l'identificativo dell'operazione viaggia su ogni tipo di evento", () => {
  it("un evento che lo porta resta valido, in ogni famiglia e per gli annullamenti: i validatori ignorano i campi in più", () => {
    const stamped = withOperationId(log.all, "op-1");
    const families = new Set(stamped.map((e) => familyOf(e) ?? "void"));
    for (const family of ["pantry", "diary", "plan", "prep", "recipes", "void"]) expect(families.has(family as never), family).toBe(true);
    for (const e of stamped) {
      expect(validateAnyEvent(e), `${e.type} ${e.id}`).toEqual([]);
      expect(operationIdOf(e)).toBe("op-1");
    }
    const others: AnyEvent[] = [
      { id: "ex-1", type: "experiment", at: "2026-03-01T08:00:00.000Z", recordedAt: "2026-03-01T08:00:00.000Z", deviceId: "dev-a", schemaVersion: 1, certainty: "measured", source: "manual", experimentId: "e1", title: "Senza latte", change: "Niente latte", startDate: "2026-03-02", endDate: "2026-03-15", measures: ["weight"] } as AnyEvent,
      { id: "ac-1", type: "allergenConfirmation", at: "2026-03-01T08:00:00.000Z", recordedAt: "2026-03-01T08:00:00.000Z", deviceId: "dev-a", schemaVersion: 1, certainty: "measured", source: "manual", action: "confirm", key: "k", ingredient: "Salsa", allergens: ["latte"] } as AnyEvent,
    ];
    expect(new Set([...families, ...others.map((e) => familyOf(e))]).size).toBe(EVENT_FAMILIES.length + 1);
    for (const e of others) {
      expect(validateAnyEvent(e), e.type).toEqual([]);
      expect(validateAnyEvent(withOperationId([e], "op-2")[0]), e.type).toEqual([]);
    }
  });

  it("non cambia niente di ciò che si deriva", () => {
    const stamped = withOperationId(log.all, "op-1");
    expect(derivePantry(stamped)).toEqual(derivePantry(log.all));
    expect(deriveDiary(stamped)).toEqual(deriveDiary(log.all));
    expect(derivePlan(stamped)).toEqual(derivePlan(log.all));
    expect(deriveRecipes(stamped)).toEqual(deriveRecipes(log.all));
    expect(derivePreps(stamped)).toEqual(derivePreps(log.all));
  });

  it("passa intatto dall'unione di due registri e da un'andata e ritorno in JSON", () => {
    const stamped = withOperationId(log.all, "op-1");
    const merged = mergeAllEvents(stamped.slice(0, 10), JSON.parse(JSON.stringify(stamped)) as AnyEvent[]);
    expect(merged.conflicts).toEqual([]);
    expect(merged.rejected).toEqual([]);
    expect(merged.events).toHaveLength(log.all.length);
    expect(merged.events.every((e) => operationIdOf(e) === "op-1")).toBe(true);
  });

  it("chi ne ha già uno lo tiene; un valore non utilizzabile vale come assente", () => {
    const [first, second] = log.all;
    const once = withOperationId([first], "op-1");
    expect(withOperationId([...once, second], "op-2").map(operationIdOf)).toEqual(["op-1", "op-2"]);
    expect(once[0]).not.toBe(first);
    expect(operationIdOf(first)).toBeUndefined();
    for (const junk of [7, "", null, {}, "x".repeat(OPERATION_ID_MAX_LENGTH + 1)]) expect(operationIdOf({ ...first, opId: junk })).toBeUndefined();
    expect(operationIdOf(null)).toBeUndefined();
    expect(operationIdOf("opId")).toBeUndefined();
    // e l'evento resta valido lo stesso: il campo non è della busta
    expect(validateAnyEvent({ ...first, opId: 7 })).toEqual([]);
  });

  it("stampOperationId: tutti gli eventi escono con l'identificativo dato, anche chi ne portava già uno", () => {
    const [first, second, third] = log.all;
    const before = [...withOperationId([first], "op-1"), second, { ...third, opId: 7 } as unknown as AnyEvent];
    const stamped = stampOperationId(before, "op-2");
    expect(stamped.map(operationIdOf)).toEqual(["op-2", "op-2", "op-2"]);
    expect(stamped.map((e) => e.id)).toEqual([first.id, second.id, third.id]);
    // gli eventi passati non vengono toccati, e il resto dell'evento è identico
    expect(before.map(operationIdOf)).toEqual(["op-1", undefined, undefined]);
    for (const [i, e] of stamped.entries()) {
      expect(validateAnyEvent(e), e.type).toEqual([]);
      const { opId: _a, ...mine } = e as AnyEvent & { opId?: unknown };
      const { opId: _b, ...theirs } = before[i] as AnyEvent & { opId?: unknown };
      void [_a, _b];
      expect(mine).toEqual(theirs);
    }
    expect(stampOperationId([], "op-3")).toEqual([]);
  });

  it("stampOperationId su un registro intero non cambia niente di ciò che si deriva", () => {
    const stamped = stampOperationId(withOperationId(log.all.slice(0, 5), "op-vecchio").concat(log.all.slice(5)), "op-nuovo");
    expect(derivePantry(stamped)).toEqual(derivePantry(log.all));
    expect(deriveDiary(stamped)).toEqual(deriveDiary(log.all));
    expect(stamped.every((e) => operationIdOf(e) === "op-nuovo")).toBe(true);
  });
});
