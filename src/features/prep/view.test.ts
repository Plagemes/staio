import { describe, expect, it } from "vitest";
import type { AnyEvent } from "@/core/events";
import { derivePantry, type ConsumeEvent, type Lot } from "@/core/ledger";
import { consume, voidOf } from "@/core/ledger/test-helpers";
import { derivePlan } from "@/core/plan";
import { prepEntry, weekEv } from "@/core/plan/test-helpers";
import { composePrep, derivePreps, proposePrepRepair, voidPrep } from "@/core/prep";
import { NOW, lotsOf } from "./test-helpers";
import {
  coverageText,
  cookByText,
  describeRepair,
  portionsText,
  portionsUsedExplanation,
  prepExpiry,
  prepRows,
  programTasks,
  repairItemText,
  repairItems,
  repairSignature,
} from "./view";

function cook(events: AnyEvent[], title: string, portions: number, prepId = title, at = "2026-11-15T17:00:00.000Z") {
  const lots = derivePantry(events).lots;
  const riso = lots.find((l) => l.lotId === "riso") as Lot;
  const r = composePrep(
    { prepId, title, ingredients: [{ lot: riso, quantity: { value: 100, unit: "g" } }], portions, location: "frigo", shelfDays: 4 },
    { deviceId: "dev-a", now: () => at },
  );
  if (!r.ok) throw new Error("atteso ok");
  return r;
}

const base = () => lotsOf([{ id: "riso", name: "Riso", value: 1000, priceCents: 400 }]).events;

describe("prepRows e scadenza", () => {
  it("mette prima le preparazioni in corso, dalla scadenza più vicina, poi quelle finite", () => {
    const events = base();
    const a = cook(events, "Zuppa", 4, "zuppa", "2026-11-14T17:00:00.000Z");
    const b = cook([...events, ...a.events], "Ragù", 2, "ragu", "2026-11-15T17:00:00.000Z");
    const state = derivePreps([...events, ...a.events, ...b.events]);
    const rows = prepRows(state, NOW);
    expect(rows.active.map((r) => r.prep.title)).toEqual(["Zuppa", "Ragù"]);
    expect(rows.finished).toEqual([]);
  });

  it("la scadenza è sempre una stima e segnala l'urgenza", () => {
    const events = base();
    const c = cook(events, "Zuppa", 4, "zuppa", "2026-11-12T17:00:00.000Z"); // dura 4 giorni: scade il 16
    const prep = derivePreps([...events, ...c.events]).preps[0];
    const e = prepExpiry(prep, NOW);
    expect(e?.estimated).toBe(true);
    expect(e?.level).toBe("urgent");
    expect(e?.text).toBe("oggi");
  });
});

describe("testi", () => {
  it("porzioni rimaste", () => {
    expect(portionsText({ remaining: 4, portions: 6, status: "active" })).toBe("4 porzioni su 6");
    expect(portionsText({ remaining: 1, portions: 6, status: "active" })).toBe("Ultima porzione, su 6");
    expect(portionsText({ remaining: 0, portions: 6, status: "finished" })).toBe("Finite");
  });

  it("spiega perché non si può annullare", () => {
    const text = portionsUsedExplanation({ eaten: 2, discarded: 1, gifted: 0 });
    expect(text).toContain("2 mangiate, 1 buttata");
    expect(text).toContain("Non posso togliere");
  });

  it("dice entro quando cucinare", () => {
    const task = { cookBy: "2026-11-20" } as never;
    expect(cookByText({ daysLeft: 0, task })).toBe("Da fare entro oggi");
    expect(cookByText({ daysLeft: 1, task })).toBe("Da fare entro domani");
    expect(cookByText({ daysLeft: -1, task })).toBe("Era da fare entro ieri");
  });

  it("copertura delle porzioni già pronte", () => {
    expect(coverageText({ needed: 5, covered: 3, toCook: 2 })).toBe("3 porzioni già pronte, 2 da cucinare");
    expect(coverageText({ needed: 4, covered: 4, toCook: 0 })).toContain("sono già pronte");
  });
});

describe("programTasks", () => {
  const plan = derivePlan([
    weekEv("w1", "2026-11-10T10:00:00.000Z", "2026-11-16", [
      prepEntry("2026-11-17", "lunch", "ragu", 2),
      prepEntry("2026-11-18", "dinner", "ragu", 3),
    ]),
  ]);

  it("senza porzioni pronte propone di cucinare tutto, entro il primo uso", () => {
    const p = programTasks(plan, derivePreps([]), NOW);
    expect(p.coverage).toEqual([]);
    expect(p.tasks).toHaveLength(1);
    expect(p.tasks[0]?.task.servings).toBe(5);
    expect(p.tasks[0]?.task.cookBy).toBe("2026-11-17");
    expect(p.tasks[0]?.daysLeft).toBe(1);
    expect(p.tasks[0]?.overdue).toBe(false);
  });

  it("con porzioni già pronte cucina solo il resto e dichiara cosa è coperto", () => {
    const events = base();
    const c = cook(events, "Ragù", 3, "ragu");
    const state = derivePreps([...events, ...c.events]);
    const p = programTasks(plan, state, NOW);
    expect(p.coverage).toEqual([{ prepId: "ragu", title: "Ragù", needed: 5, covered: 3, toCook: 2 }]);
    expect(p.tasks.reduce((s, t) => s + t.task.servings, 0)).toBe(2);
  });

  it("se le porzioni bastano non c'è nulla da cucinare", () => {
    const events = base();
    const c = cook(events, "Ragù", 6, "ragu");
    const p = programTasks(plan, derivePreps([...events, ...c.events]), NOW);
    expect(p.tasks).toEqual([]);
    expect(p.coverage[0]?.toCook).toBe(0);
  });

  it("senza piano non c'è programma", () => {
    expect(programTasks(derivePlan([]), derivePreps([]), NOW)).toEqual({ tasks: [], coverage: [] });
  });
});

describe("riparazione di una preparazione annullata con porzioni usate", () => {
  function scenario() {
    const events = base();
    const c = cook(events, "Ragù", 4, "ragu");
    const log = [...events, ...c.events] as AnyEvent[];
    const v = voidPrep("ragu", log, { deviceId: "dev-a", now: () => "2026-11-15T18:00:00.000Z" });
    if (!v.ok) throw new Error("atteso ok");
    // un altro dispositivo, non ancora sincronizzato, ha mangiato una porzione
    const eaten = consume("x1", "2026-11-15T17:30:00.000Z", { lotId: c.batchLotId, quantity: { value: 1, unit: "pz" }, deviceId: "dev-b" }) as ConsumeEvent;
    return { log: [...log, ...v.events, eaten] as AnyEvent[], events };
  }

  it("la preparazione annullata compare tra le cose da sistemare, con il suo nome", () => {
    const { log } = scenario();
    const items = repairItems(derivePreps(log), log);
    expect(items).toEqual([{ prepId: "ragu", title: "Ragù", usedPortions: 1, portions: 4, pendingPortions: 1, kinds: ["pending"] }]);
    expect(repairItemText(items[0] as never)).toContain("1 porzione su 4 risulta usata");
  });

  it("descrive cosa verrebbe tolto dalla dispensa, senza scrivere niente", () => {
    const { log } = scenario();
    const r = proposePrepRepair("ragu", log, { deviceId: "dev-a", now: () => NOW });
    if (!r.ok) throw new Error("atteso ok");
    const view = describeRepair(r, derivePantry(log).lots);
    expect(view.lines).toEqual(["Riso 25 g"]);
    expect(view.explanation).toContain("1 porzione su 4");
    expect(view.explanation).toContain("stima");
    expect(view.redundant).toBe(0);
    expect(view.shortfalls).toEqual([]);
    expect(r.voids).toEqual([]);
  });

  it("la firma della correzione non dipende dagli identificativi, ma dalle quantità", () => {
    const { log } = scenario();
    const first = proposePrepRepair("ragu", log, { deviceId: "dev-a", now: () => NOW });
    const again = proposePrepRepair("ragu", log, { deviceId: "dev-a", now: () => NOW });
    if (!first.ok || !again.ok) throw new Error("atteso ok");
    expect(repairSignature(first)).toBe(repairSignature(again));
    // un altro telefono ha mangiato un'altra porzione: la correzione scalerebbe una quantità diversa
    const batchLot = (log.find((e) => e.type === "consume" && (e as ConsumeEvent).deviceId === "dev-b") as ConsumeEvent).lotId;
    const more = consume("x9", "2026-11-15T17:45:00.000Z", { lotId: batchLot, quantity: { value: 1, unit: "pz" }, deviceId: "dev-b" }) as ConsumeEvent;
    const changed = proposePrepRepair("ragu", [...log, more] as AnyEvent[], { deviceId: "dev-a", now: () => NOW });
    if (!changed.ok) throw new Error("atteso ok");
    expect(repairSignature(changed)).not.toBe(repairSignature(first));
  });

  it("dichiara le carenze: in dispensa resta meno di ciò che andrebbe scalato", () => {
    const { log } = scenario();
    // dopo l'annullamento restano 1000 g di riso; se ne consumano 990 e ne restano 10
    const drained = [...log, consume("drain", "2026-11-15T19:00:00.000Z", { lotId: "riso", quantity: { value: 990, unit: "g" } })] as AnyEvent[];
    const r = proposePrepRepair("ragu", drained, { deviceId: "dev-a", now: () => NOW });
    if (!r.ok) throw new Error("atteso ok");
    expect(r.shortfalls).toHaveLength(1);
    const view = describeRepair(r, derivePantry(drained).lots);
    expect(view.shortfalls[0]).toBe("Di riso restano 10 g, ne andrebbero scalati 25 g: scalo solo ciò che c'è");
  });

  it("riparazioni doppie: si mostra l'anomalia e la proposta le annulla insieme", () => {
    const { log } = scenario();
    const eatenMore = consume("x2", "2026-11-15T17:40:00.000Z", { lotId: "dummy", quantity: { value: 1, unit: "pz" }, deviceId: "dev-b" }) as ConsumeEvent;
    const batchLot = (log.find((e) => e.type === "consume" && (e as ConsumeEvent).deviceId === "dev-b") as ConsumeEvent).lotId;
    const more = { ...eatenMore, lotId: batchLot };
    // due dispositivi riparano prima di sincronizzarsi: uno copre il primo uso, l'altro entrambi
    const first = proposePrepRepair("ragu", log, { deviceId: "dev-a", now: () => NOW });
    const withMore = [...log, more] as AnyEvent[];
    const second = proposePrepRepair("ragu", withMore, { deviceId: "dev-b", now: () => NOW });
    if (!first.ok || !second.ok) throw new Error("atteso ok");
    const merged = [...withMore, ...first.events, ...second.events] as AnyEvent[];
    const items = repairItems(derivePreps(merged), merged);
    expect(items[0]?.kinds).toContain("overlap");
    expect(repairItemText(items[0] as never)).toContain("due correzioni");
    const fix = proposePrepRepair("ragu", merged, { deviceId: "dev-a", now: () => NOW });
    if (!fix.ok) throw new Error("atteso ok");
    expect(fix.voids.length).toBeGreaterThan(0);
    const view = describeRepair(fix, derivePantry(merged).lots);
    expect(view.redundant).toBe(fix.voids.length);
    const after = [...merged, ...fix.events, ...fix.voids] as AnyEvent[];
    expect(repairItems(derivePreps(after), after)).toEqual([]);
  });

  it("dopo la riparazione l'anomalia sparisce", () => {
    const { log } = scenario();
    const r = proposePrepRepair("ragu", log, { deviceId: "dev-a", now: () => NOW });
    if (!r.ok) throw new Error("atteso ok");
    const after = [...log, ...r.events] as AnyEvent[];
    expect(repairItems(derivePreps(after), after)).toEqual([]);
  });

  it("una correzione che copre un uso poi annullato è da annullare", () => {
    const { log } = scenario();
    const r = proposePrepRepair("ragu", log, { deviceId: "dev-a", now: () => NOW });
    if (!r.ok) throw new Error("atteso ok");
    const eatenId = (log.find((e) => e.type === "consume" && (e as ConsumeEvent).deviceId === "dev-b") as ConsumeEvent).id;
    const unEaten = voidOf("u1", "2026-11-16T09:30:00.000Z", eatenId);
    const after = [...log, ...r.events, unEaten] as AnyEvent[];
    const items = repairItems(derivePreps(after), after);
    expect(items[0]?.kinds).toContain("stale");
    expect(repairItemText(items[0] as never)).toContain("uso è stato poi annullato");
    const fix = proposePrepRepair("ragu", after, { deviceId: "dev-a", now: () => NOW });
    if (!fix.ok) throw new Error("atteso ok");
    expect(fix.voids.length).toBeGreaterThan(0);
    expect(describeRepair(fix, derivePantry(after).lots).redundant).toBe(fix.voids.length);
    const done = [...after, ...fix.events, ...fix.voids] as AnyEvent[];
    expect(repairItems(derivePreps(done), done)).toEqual([]);
  });

  it("una preparazione ripristinata con le correzioni ancora attive è da sistemare", () => {
    const { log } = scenario();
    const r = proposePrepRepair("ragu", log, { deviceId: "dev-a", now: () => NOW });
    if (!r.ok) throw new Error("atteso ok");
    const prepVoids = log.filter((e) => e.type === "void" && (e as { targetEventId: string }).targetEventId !== "x1");
    const restore = prepVoids.map((v, i) => voidOf(`re-${i}`, "2026-11-16T09:30:00.000Z", v.id));
    const after = [...log, ...r.events, ...restore] as AnyEvent[];
    const state = derivePreps(after);
    expect(state.preps.map((p) => p.prepId)).toEqual(["ragu"]);
    const items = repairItems(state, after);
    expect(items[0]?.kinds).toContain("active");
    expect(items[0]?.title).toBe("Ragù");
    expect(repairItemText(items[0] as never)).toContain("scalati due volte");
    const fix = proposePrepRepair("ragu", after, { deviceId: "dev-a", now: () => NOW });
    if (!fix.ok) throw new Error("atteso ok");
    expect(fix.voids.length).toBeGreaterThan(0);
    const done = [...after, ...fix.events, ...fix.voids] as AnyEvent[];
    expect(repairItems(derivePreps(done), done)).toEqual([]);
  });

  it("senza anomalie non c'è nulla da mostrare", () => {
    const events = base();
    const c = cook(events, "Ragù", 4, "ragu");
    const log = [...events, ...c.events] as AnyEvent[];
    expect(repairItems(derivePreps(log), log)).toEqual([]);
  });
});
