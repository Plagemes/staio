import { describe, expect, it } from "vitest";
import { mergeEvents } from "../ledger";
import { createMealDeclaration, InvalidDiaryEventError } from "./create";
import { deriveDiary } from "./derive";
import {
  dayCoverage,
  dayFluids,
  drinkBreaksFast,
  drinksByMoment,
  getDay,
  habitsToPropose,
  mealMoments,
  momentOfMinutes,
} from "./selectors";
import { declaration, drink, habit, meal, seededRandom, shuffled, untracked, voidOf } from "./test-helpers";
import { validateDiaryEvent } from "./validate";

const D = "2026-03-10";
const TZ = { timeZone: "UTC" };
const at = (hhmm: string, date = D) => `${date}T${hhmm}:00.000Z`;
const breakfast = meal("b1", at("07:30"), { mealId: "mb", kind: "breakfast" });
const dinner = meal("d1", at("19:30"), { mealId: "md", kind: "dinner" });
const lunchMeal = meal("l1", at("12:30"), { mealId: "ml", kind: "lunch" });
const lunchDecl = (id: string, recordedAt: string, status: "skipped" | "untracked" = "skipped") =>
  declaration(id, recordedAt, { date: D, kind: "lunch", status, recordedAt });

const coverage = (events: unknown[]) => dayCoverage(getDay(deriveDiary(events, TZ), D), D);

describe("evento mealDeclaration: validazione e creazione", () => {
  const ok = lunchDecl("x", at("14:00"));

  it("accetta data, momento e stato validi", () => {
    expect(validateDiaryEvent(ok)).toEqual([]);
  });

  it("rifiuta data, momento e stato non validi", () => {
    const codes = (e: unknown) => validateDiaryEvent(e).map((x) => `${x.path}:${x.code}`);
    expect(codes({ ...ok, date: undefined })).toEqual(["date:required"]);
    expect(codes({ ...ok, date: "2026-02-30" })).toEqual(["date:invalid_value"]);
    expect(codes({ ...ok, date: 20260310 })).toEqual(["date:invalid_type"]);
    expect(codes({ ...ok, kind: "snack" })).toEqual(["kind:invalid_value"]);
    expect(codes({ ...ok, status: "fasting" })).toEqual(["status:invalid_value"]);
    expect(codes({ ...ok, status: undefined })).toEqual(["status:required"]);
  });

  it("createMealDeclaration scrive un evento valido, misurato, con la data indicata", () => {
    const e = createMealDeclaration(
      { date: "2026-03-09", kind: "lunch", status: "skipped" },
      { deviceId: "dev-a", now: () => at("21:00"), idGenerator: () => "id-1" },
    );
    expect(e).toMatchObject({ type: "mealDeclaration", date: "2026-03-09", kind: "lunch", status: "skipped", certainty: "measured" });
    expect(validateDiaryEvent(e)).toEqual([]);
    expect(() => createMealDeclaration({ date: "ieri", kind: "lunch", status: "skipped" }, { deviceId: "dev-a" })).toThrow(
      InvalidDiaryEventError,
    );
  });

  it("le bevande accettano energia e zuccheri e rifiutano i valori negativi", () => {
    const d = drink("d", at("08:00"), { name: "Cola", ml: 330, energyKcal: 139, sugarsG: 35 });
    expect(validateDiaryEvent(d)).toEqual([]);
    expect(validateDiaryEvent({ ...d, energyKcal: -1 }).map((e) => e.path)).toEqual(["energyKcal"]);
  });
});

describe("dichiarazione di un momento: regola deterministica", () => {
  it("il giorno è quello della data dichiarata, non quello dell'istante della dichiarazione", () => {
    const e = declaration("x", "2026-03-12T09:00:00.000Z", { date: D, kind: "lunch", status: "skipped" });
    const state = deriveDiary([e], TZ);
    expect(state.days.map((d) => d.date)).toEqual([D]);
    expect(getDay(state, D)?.declarations).toMatchObject([{ kind: "lunch", status: "skipped", eventId: "x" }]);
  });

  it("per lo stesso giorno e momento vale la più recente; a parità, l'id maggiore", () => {
    const a = lunchDecl("a", at("14:00"), "skipped");
    const b = lunchDecl("b", at("15:00"), "untracked");
    expect(getDay(deriveDiary([a, b], TZ), D)?.declarations[0]).toMatchObject({ eventId: "b", status: "untracked" });
    expect(getDay(deriveDiary([b, a], TZ), D)?.declarations[0]).toMatchObject({ eventId: "b", status: "untracked" });
    const c = lunchDecl("c", at("15:00"), "skipped");
    expect(getDay(deriveDiary([c, b], TZ), D)?.declarations[0].eventId).toBe("c");
  });

  it("l'unione è commutativa e idempotente: ogni ordine dà lo stesso diario", () => {
    const events = [
      breakfast,
      dinner,
      lunchDecl("a", at("14:00"), "skipped"),
      lunchDecl("b", at("15:00"), "untracked"),
      lunchDecl("c", at("16:00"), "skipped"),
      declaration("z", at("16:30"), { date: D, kind: "breakfast", status: "untracked" }),
      voidOf("v", at("17:00"), "c"),
      drink("t", at("08:00"), { name: "Tè", ml: 200 }),
    ];
    const expected = deriveDiary(events, TZ);
    const random = seededRandom(7);
    for (let i = 0; i < 25; i++) {
      const order = shuffled(events, random);
      const cut = Math.floor(random() * order.length);
      const merged = mergeEvents(order.slice(0, cut) as never, order.slice(cut) as never).events;
      expect(deriveDiary(merged, TZ)).toEqual(expected);
      expect(deriveDiary([...order, ...order], TZ)).toEqual(expected);
    }
    // c è annullata: torna a valere b
    expect(getDay(expected, D)?.declarations.find((d) => d.kind === "lunch")).toMatchObject({ eventId: "b", status: "untracked" });
  });

  it("annullare la dichiarazione più recente riporta quella di prima; annullare l'annullamento la ripristina", () => {
    const a = lunchDecl("a", at("14:00"), "untracked");
    const b = lunchDecl("b", at("15:00"), "skipped");
    const lunch = (events: unknown[]) => getDay(deriveDiary(events, TZ), D)?.declarations.find((d) => d.kind === "lunch");
    expect(lunch([a, b, voidOf("v1", at("16:00"), "b")])).toMatchObject({ eventId: "a" });
    expect(lunch([a, b, voidOf("v1", at("16:00"), "b"), voidOf("v2", at("16:01"), "v1")])).toMatchObject({ eventId: "b" });
    expect(lunch([b, voidOf("v1", at("16:00"), "b")])).toBeUndefined();
  });

  it("un pasto registrato nello stesso momento prevale e la dichiarazione non conta più, senza cancellarla", () => {
    const skip = lunchDecl("a", at("12:00"));
    const day = getDay(deriveDiary([skip, lunchMeal], TZ), D);
    expect(mealMoments(day).find((m) => m.kind === "lunch")?.status).toBe("recorded");
    expect(day?.declarations[0]).toMatchObject({ eventId: "a", supersededBy: "meal" });
    expect(deriveDiary([skip, lunchMeal], TZ).voidedEventIds).toEqual([]);
    expect(dayCoverage(day, D).skipped).toEqual([]);
    // annullato il pasto, la dichiarazione torna in vigore
    const back = getDay(deriveDiary([skip, lunchMeal, voidOf("v", at("13:00"), "l1")], TZ), D);
    expect(mealMoments(back).find((m) => m.kind === "lunch")?.status).toBe("skipped");
  });

  it("un vecchio «non tracciato» più recente contraddice un «saltato»; più vecchio, è superato", () => {
    const old = untracked("u", at("10:00"), { kind: "lunch" });
    const skip = lunchDecl("a", at("14:00"));
    const lunchOf = (events: unknown[]) => mealMoments(getDay(deriveDiary(events, TZ), D)).find((m) => m.kind === "lunch");
    expect(lunchOf([old, skip])?.status).toBe("skipped");
    expect(getDay(deriveDiary([old, skip], TZ), D)?.untrackedMeals).toEqual([]);
    const later = untracked("u2", at("20:00"), { kind: "lunch" });
    expect(lunchOf([skip, later])?.status).toBe("untracked");
    expect(getDay(deriveDiary([skip, later], TZ), D)?.declarations[0].supersededBy).toBe("newer");
    expect(coverage([breakfast, dinner, skip, later]).status).toBe("declared");
  });
});

describe("completezza del giorno nei tre stati", () => {
  it("colazione e cena registrate e pranzo «saltato»: giorno completo", () => {
    const c = coverage([breakfast, dinner, lunchDecl("a", at("15:00"))]);
    expect(c).toMatchObject({ status: "complete", skipped: ["lunch"], missing: [], untracked: 0 });
  });

  it("con «mangiato, non registrato» il giorno è dichiaratamente incompleto", () => {
    const c = coverage([breakfast, dinner, lunchDecl("a", at("15:00"), "untracked")]);
    expect(c).toMatchObject({ status: "declared", skipped: [], missing: [], untracked: 1 });
  });

  it("senza nessuna dichiarazione il pranzo è un vuoto, non un salto", () => {
    expect(coverage([breakfast, dinner])).toMatchObject({ status: "gaps", missing: ["lunch"], skipped: [] });
  });

  it("una bevanda non vale un pasto: colazione con il solo tè resta un momento da dichiarare", () => {
    const tea = drink("t", at("07:50"), { name: "Tè", ml: 200 });
    expect(coverage([tea, lunchMeal, dinner])).toMatchObject({ status: "gaps", missing: ["breakfast"] });
    const skipped = declaration("s", at("09:00"), { date: D, kind: "breakfast", status: "skipped" });
    expect(coverage([tea, lunchMeal, dinner, skipped]).status).toBe("complete");
  });

  it("i momenti dichiarati non si propongono più come pasti abituali", () => {
    const h = habit("h", at("06:00"), {
      habitId: "h1",
      title: "Solito pranzo",
      kind: "lunch",
      usualTime: "12:30",
      items: [{ name: "Riso", quantity: { value: 80, unit: "g" }, certainty: "estimated" }],
    });
    const state = (events: unknown[]) => deriveDiary(events, TZ);
    expect(habitsToPropose(state([h]), at("12:40")).map((x) => x.habitId)).toEqual(["h1"]);
    expect(habitsToPropose(state([h, lunchDecl("a", at("12:35"))]), at("12:40"))).toEqual([]);
  });
});

describe("bevande per momento", () => {
  it("stessa regola oraria del tipo di pasto proposto", () => {
    expect(momentOfMinutes(7 * 60 + 30)).toBe("breakfast");
    expect(momentOfMinutes(10 * 60 + 29)).toBe("breakfast");
    expect(momentOfMinutes(10 * 60 + 30)).toBe("lunch");
    expect(momentOfMinutes(15 * 60 + 29)).toBe("lunch");
    expect(momentOfMinutes(17 * 60)).toBe("snack");
    expect(momentOfMinutes(20 * 60)).toBe("dinner");
    expect(momentOfMinutes(23 * 60 + 30)).toBe("snack");
    expect(momentOfMinutes(3 * 60)).toBe("snack");
  });

  it("assegna ogni bevanda al suo momento o a «fuori pasto», in ordine di ora", () => {
    const events = [
      drink("d3", at("21:00"), { name: "Vino", ml: 150, alcoholG: 14 }),
      drink("d1", at("08:12"), { name: "Tè", ml: 200 }),
      drink("d2", at("16:45"), { name: "Caffè", ml: 30 }),
      drink("d4", at("12:00"), { name: "Cola", ml: 330 }),
    ];
    const by = drinksByMoment(getDay(deriveDiary(events, TZ), D), "UTC");
    expect(by.breakfast.map((d) => d.name)).toEqual(["Tè"]);
    expect(by.lunch.map((d) => d.name)).toEqual(["Cola"]);
    expect(by.dinner.map((d) => d.name)).toEqual(["Vino"]);
    expect(by.offMeal.map((d) => d.name)).toEqual(["Caffè"]);
  });

  it("usa il fuso del diario", () => {
    const e = drink("d1", "2026-03-10T06:30:00.000Z", { name: "Tè", ml: 200 });
    const by = drinksByMoment(getDay(deriveDiary([e], { timeZone: "Europe/Rome" }), D), "Europe/Rome");
    expect(by.breakfast).toHaveLength(1); // 07:30 a Roma
  });

  it("regola dell'energia: alcol, zuccheri o 5 kcal e più interrompono; tè e caffè senza zucchero no; senza dato è non noto", () => {
    expect(drinkBreaksFast({ energyKcal: 1 })).toBe("no");
    expect(drinkBreaksFast({ energyKcal: 139, sugarsG: 35 })).toBe("yes");
    expect(drinkBreaksFast({ alcoholG: 13 })).toBe("yes");
    expect(drinkBreaksFast({ energyKcal: 0, sugarsG: 8 })).toBe("yes");
    expect(drinkBreaksFast({})).toBe("unknown");
  });

  it("liquidi: acqua, altre bevande e alcolici restano distinti", () => {
    const events = [
      drink("d1", at("08:12"), { name: "Tè", ml: 200 }),
      drink("d2", at("12:00"), { name: "Birra", ml: 330, alcoholG: 13 }),
    ];
    const day = getDay(deriveDiary(events, TZ), D);
    expect(dayFluids(day)).toEqual({ waterMl: 0, otherMl: 200, alcoholicMl: 330 });
    expect(dayFluids(undefined)).toEqual({ waterMl: 0, otherMl: 0, alcoholicMl: 0 });
  });
});
