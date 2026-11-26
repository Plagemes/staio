import { describe, expect, it } from "vitest";
import { derivePantry } from "../ledger";
import { DIARY_EVENT_TYPES, OTHER_FAMILY_EVENT_TYPES, deriveDiary } from "../diary";
import { PLAN_EVENT_TYPES, derivePlan } from "../plan";
import { seededRandom, shuffled } from "../plan/test-helpers";
import { PREP_EVENT_TYPES, derivePreps } from "../prep";
import { RECIPE_EVENT_TYPES, deriveRecipes } from "../recipes";
import { water } from "../diary/test-helpers";
import {
  ALL_EVENT_TYPES,
  EVENT_FAMILIES,
  eventsOfFamily,
  familyOf,
  isKnownEvent,
  mergeAllEvents,
  validateAnyEvent,
  type AnyEvent,
  type EventFamily,
} from "./index";
import { mixedLog } from "./test-helpers";

const log = mixedLog();
const codes = (e: unknown) => validateAnyEvent(e).map((x) => `${x.path}:${x.code}`);
/** `voidedEventIds` elenca i bersagli di tutti i void del registro, di ogni famiglia: si confrontano a parte. */
const withoutVoided = <T extends { voidedEventIds: string[] }>(s: T): Omit<T, "voidedEventIds"> => {
  const { voidedEventIds: _ignored, ...rest } = s;
  void _ignored;
  return rest;
};
const ownVoided = (ids: string[], family: EventFamily): string[] => {
  const mine = new Set(eventsOfFamily(log.all, family).map((e) => e.id));
  return ids.filter((id) => mine.has(id));
};
const own = (family: EventFamily): AnyEvent[] => {
  const events = eventsOfFamily(log.all, family);
  const ids = new Set(events.map((e) => e.id));
  const voids = log.all.filter(
    (e) => e.type === "void" && ids.has((e as { targetEventId: string }).targetEventId),
  );
  return [...events, ...voids];
};

describe("famiglie di eventi", () => {
  it("l'elenco delle famiglie coincide con i tipi esportati dai moduli", () => {
    const byName = Object.fromEntries(EVENT_FAMILIES.map((f) => [f.family, f.types]));
    expect(byName.diary).toEqual([...DIARY_EVENT_TYPES]);
    expect(byName.plan).toEqual([...PLAN_EVENT_TYPES]);
    expect(byName.prep).toEqual([...PREP_EVENT_TYPES]);
    expect(byName.recipes).toEqual([...RECIPE_EVENT_TYPES]);
    expect(byName.pantry).toContain("purchase");
    expect(byName.pantry).not.toContain("void");
    expect(ALL_EVENT_TYPES).toContain("void");
    expect(new Set(ALL_EVENT_TYPES).size).toBe(ALL_EVENT_TYPES.length);
  });

  it("l'elenco delle altre famiglie nel diario non è andato fuori sincrono", () => {
    expect([...OTHER_FAMILY_EVENT_TYPES].sort()).toEqual(
      [...PLAN_EVENT_TYPES, ...PREP_EVENT_TYPES, ...RECIPE_EVENT_TYPES, "experiment", "allergenConfirmation", "allergenDeclaration"].sort(),
    );
  });

  it("familyOf riconosce la famiglia; void e sconosciuti no", () => {
    const families = new Set(log.all.map((e) => familyOf(e)));
    expect(families).toEqual(new Set(["pantry", "diary", "plan", "prep", "recipes", undefined]));
    expect(familyOf(log.voids[0])).toBeUndefined();
    expect(familyOf({ type: "sonno" })).toBeUndefined();
    expect(familyOf(null)).toBeUndefined();
    expect(eventsOfFamily(log.all, "recipes").map((e) => e.id)).toEqual(["rc1", "rc2"]);
  });
});

describe("validateAnyEvent con tutte le famiglie", () => {
  it("accetta ogni evento valido di ogni famiglia", () => {
    for (const family of ["pantry", "diary", "plan", "prep", "recipes"] as const) {
      const events = eventsOfFamily(log.all, family);
      expect(events.length).toBeGreaterThan(0);
      for (const e of events) expect(validateAnyEvent(e)).toEqual([]);
      expect(isKnownEvent(events[0])).toBe(true);
    }
    for (const v of log.voids) expect(validateAnyEvent(v)).toEqual([]);
    expect(new Set(eventsOfFamily(log.all, "plan").map((e) => e.type))).toEqual(new Set(PLAN_EVENT_TYPES));
  });

  it("instrada al validatore giusto: un errore di ogni famiglia", () => {
    const first = (family: EventFamily) => eventsOfFamily(log.all, family)[0];
    expect(codes({ ...first("diary"), type: "water", ml: -1 })).toEqual(["ml:not_positive"]);
    const dayType = eventsOfFamily(log.all, "plan").find((e) => e.type === "dayType")!;
    expect(codes({ ...dayType, dayType: undefined })).toContain("dayType:required");
    expect(codes({ ...eventsOfFamily(log.all, "plan").find((e) => e.type === "planWeek")!, weekStart: "2026-03-10" }).length).toBeGreaterThan(0);
    expect(codes({ ...eventsOfFamily(log.all, "prep").find((e) => e.type === "prep")!, prepId: undefined })).toContain("prepId:required");
    expect(codes({ ...first("recipes"), recipeId: undefined })).toContain("recipeId:required");
    expect(codes({ ...first("pantry"), lotId: undefined })).toContain("lotId:required");
  });

  it("un tipo davvero sconosciuto resta un errore, e non è noto", () => {
    expect(codes({ ...log.diary[0], type: "sonno" })).toEqual(["type:invalid_value"]);
    expect(isKnownEvent({ ...log.diary[0], type: "sonno" })).toBe(false);
    expect(isKnownEvent({ type: "recipe" })).toBe(true);
    expect(isKnownEvent({ type: "prep" })).toBe(true);
    expect(isKnownEvent({ type: "planWeek" })).toBe(true);
  });
});

describe("registro misto con tutte e cinque le famiglie", () => {
  it("la dispensa è identica a quella calcolata dai soli eventi propri", () => {
    const full = derivePantry(log.all as never);
    const alone = derivePantry(own("pantry") as never);
    expect(withoutVoided(full)).toEqual(withoutVoided(alone));
    expect(ownVoided(full.voidedEventIds, "pantry")).toEqual(alone.voidedEventIds);
    expect(full.lots.length).toBeGreaterThan(3);
    expect(full.anomalies).toEqual([]);
  });

  it("il diario è identico a quello calcolato dai soli eventi propri, senza anomalie spurie", () => {
    const full = deriveDiary(log.all);
    const alone = deriveDiary(own("diary"));
    expect(withoutVoided(full)).toEqual(withoutVoided(alone));
    expect(ownVoided(full.voidedEventIds, "diary")).toEqual(alone.voidedEventIds);
    expect(full.anomalies).toEqual([]);
    expect(full.days).toHaveLength(1);
    expect(full.days[0].waterMl).toBe(250); // w-gone annullato da un void
  });

  it("i void attraversano le famiglie", () => {
    expect(derivePantry(log.all as never).voidedEventIds).toContain("c-free");
    expect(deriveDiary(log.all).voidedEventIds).toEqual(
      expect.arrayContaining(["w-gone", "c-free", "pl-d2", "rc2"]),
    );
    expect(deriveRecipes(log.all).recipes.map((r) => r.recipeId)).toEqual(["r1"]);
    const plan = derivePlan(log.all);
    expect(plan.voidedEventIds).toContain("pl-d2");
  });

  it("le altre derivazioni non segnalano come anomalie gli eventi delle altre famiglie", () => {
    expect(derivePlan(log.all).anomalies).toEqual([]);
    expect(deriveRecipes(log.all).anomalies).toEqual([]);
    expect(derivePreps(log.all).anomalies).toEqual([]);
  });

  it("un tipo davvero sconosciuto resta un'anomalia del diario", () => {
    const state = deriveDiary([...log.all, { ...water("x", "2026-03-10T08:00:00.000Z", { ml: 1 }), type: "sonno" }]);
    expect(state.anomalies).toEqual([{ code: "unknown_event_type", eventId: "x", eventType: "sonno" }]);
  });

  it("un conflitto d'id tra eventi di altre famiglie non è un'anomalia del diario", () => {
    const rc = eventsOfFamily(log.all, "recipes")[0] as unknown as Record<string, unknown>;
    const other = { ...rc, title: "Altro titolo", recordedAt: "2026-03-05T08:00:00.000Z" };
    expect(deriveDiary([...log.all, other]).anomalies).toEqual([]);
    expect(deriveDiary([...log.all, other])).toEqual(deriveDiary(log.all));
  });
});

describe("mergeAllEvents su registri misti", () => {
  it("conserva tutte le famiglie, senza conflitti né scarti", () => {
    const merged = mergeAllEvents(log.all.slice(0, 20), log.all.slice(12));
    expect(merged.events).toHaveLength(log.all.length);
    expect(merged.conflicts).toEqual([]);
    expect(merged.rejected).toEqual([]);
    expect(new Set(merged.events.map((e) => familyOf(e)))).toEqual(
      new Set(["pantry", "diary", "plan", "prep", "recipes", undefined]),
    );
  });

  it("è commutativa, associativa e idempotente su permutazioni casuali a seme fisso", () => {
    const stale = eventsOfFamily(log.all, "recipes")[0] as unknown as Record<string, unknown>;
    const newer = { ...stale, title: "Più recente", recordedAt: "2026-03-05T08:00:00.000Z" } as unknown as AnyEvent;
    const corrupt = { ...stale, servings: -1, recordedAt: "2026-03-06T08:00:00.000Z" } as unknown as AnyEvent;
    const planEv = eventsOfFamily(log.all, "plan")[3] as unknown as Record<string, unknown>;
    const planNewer = { ...planEv, dayType: "training", recordedAt: "2026-03-05T08:00:00.000Z" } as unknown as AnyEvent;
    const planCorrupt = { ...planEv, dayType: undefined, recordedAt: "2026-03-07T08:00:00.000Z" } as unknown as AnyEvent;
    const pool: AnyEvent[] = [...log.all, newer, corrupt, planNewer, planCorrupt];
    const expected = mergeAllEvents(pool, []);
    expect(expected.conflicts.map((c) => c.id).sort()).toEqual(["pl-d1", "rc1"]);
    expect(expected.events.find((e) => e.id === "rc1")).toEqual(newer);
    expect(expected.events.find((e) => e.id === "pl-d1")).toEqual(planNewer);

    const random = seededRandom(20260317);
    for (let i = 0; i < 40; i++) {
      const order = shuffled(pool, random);
      const cut1 = Math.floor(random() * order.length);
      const cut2 = cut1 + Math.floor(random() * (order.length - cut1));
      const a = order.slice(0, cut1);
      const b = order.slice(cut1, cut2);
      const c = order.slice(cut2);
      const left = mergeAllEvents(mergeAllEvents(a, b).events, c).events;
      const right = mergeAllEvents(a, mergeAllEvents(b, c).events).events;
      expect(left).toEqual(expected.events);
      expect(right).toEqual(expected.events);
      expect(mergeAllEvents(b, a).events).toEqual(mergeAllEvents(a, b).events);
      expect(mergeAllEvents(left, left).events).toEqual(left);
      expect(mergeAllEvents(left, order).events).toEqual(left);
    }
  });

  it("dopo l'unione, la derivazione di ogni famiglia non cambia con l'ordine", () => {
    const random = seededRandom(99);
    const expected = {
      pantry: derivePantry(log.all as never),
      diary: deriveDiary(log.all),
      plan: derivePlan(log.all),
      recipes: deriveRecipes(log.all),
    };
    for (let i = 0; i < 10; i++) {
      const order = shuffled(log.all, random);
      const merged = mergeAllEvents(order.slice(0, 15), order.slice(15)).events;
      expect(derivePantry(merged as never)).toEqual(expected.pantry);
      expect(deriveDiary(merged)).toEqual(expected.diary);
      expect(derivePlan(merged)).toEqual(expected.plan);
      expect(deriveRecipes(merged)).toEqual(expected.recipes);
    }
  });

  it("void tra famiglie diverse: validi, uniti e con effetto sul bersaglio", () => {
    for (const v of log.voids) expect(validateAnyEvent(v)).toEqual([]);
    const merged = mergeAllEvents(log.voids, log.all).events;
    expect(merged.filter((e) => e.type === "void")).toHaveLength(log.voids.length);
    expect(ownVoided(deriveDiary(merged).voidedEventIds, "diary")).toEqual(["w-gone"]);
    expect(deriveDiary(merged).days[0].waterMl).toBe(250);
  });
});

describe("allergenDeclaration", () => {
  const declaration = {
    id: "ad-1",
    type: "allergenDeclaration",
    at: "2026-03-01T08:00:00.000Z",
    recordedAt: "2026-03-01T08:00:00.000Z",
    deviceId: "dev-a",
    schemaVersion: 1,
    certainty: "measured",
    source: "manual",
    action: "add",
    list: "allergens",
    text: "latte",
  } as AnyEvent;

  it("è un tipo conosciuto, nella famiglia delle conferme sugli allergeni", () => {
    expect(ALL_EVENT_TYPES).toContain("allergenDeclaration");
    expect(familyOf(declaration)).toBe("allergenConfirmations");
    expect(isKnownEvent(declaration)).toBe(true);
    expect(validateAnyEvent(declaration)).toEqual([]);
  });

  it("un evento non valido è respinto", () => {
    expect(validateAnyEvent({ ...declaration, list: "altro" } as unknown as AnyEvent).length).toBeGreaterThan(0);
    expect(validateAnyEvent({ ...declaration, text: "" } as unknown as AnyEvent).length).toBeGreaterThan(0);
  });
});
