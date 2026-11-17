import { describe, expect, it } from "vitest";
import { deriveDiary } from "../diary";
import { declaration, meal, supplement, water } from "../diary/test-helpers";
import type { AnyEvent } from "../events";
import { derivePantry } from "../ledger";
import { adjust, consume, purchase, q, updateLot } from "../ledger/test-helpers";
import { buildBriefing, MAX_LINES } from "./briefing";
import { normalizeDismissed, rememberDismissed } from "./dismissed";
import { buildReviewItems } from "./review";
import type { PrepRecord, PrepState } from "../prep";
import type { BriefingInput } from "./types";

// 2026-11-17 alle 10:00 a Roma (UTC+1)
const NOW = "2026-11-17T09:00:00Z";

function make(events: unknown[], over: Partial<BriefingInput> = {}): BriefingInput {
  return {
    now: NOW,
    pantry: derivePantry(events),
    diary: deriveDiary(events),
    log: events as AnyEvent[],
    ...over,
  };
}

const lot = (id: string, name: string, extra: Record<string, unknown> = {}, at = "2026-11-10T08:00:00Z") =>
  purchase(`p-${id}`, at, { lotId: id, productRef: name, quantity: q(500), location: "frigo", category: "dairy", ...extra });

describe("riepilogo del giorno", () => {
  it("giornata vuota: nessuna riga, la scheda non compare", () => {
    const b = buildBriefing(make([]));
    expect(b.lines).toEqual([]);
    expect(b.reviewCount).toBe(0);
  });

  it("nel giorno passato il riepilogo non compare, anche con cose da dire", () => {
    const events = [lot("a", "Yogurt", { expiry: { date: "2026-11-17", kind: "use_by" } })];
    const b = buildBriefing(make(events, { viewDate: "2026-11-16" }));
    expect(b.lines).toEqual([]);
    expect(b.review).toEqual([]);
  });

  it("scadenze di oggi e domani con quante cose, la data stampata non è una stima", () => {
    const events = [
      lot("a", "Yogurt", { expiry: { date: "2026-11-17", kind: "use_by" } }),
      lot("b", "Latte", { expiry: { date: "2026-11-18", kind: "use_by" } }),
      lot("c", "Burro", { expiry: { date: "2026-11-18", kind: "use_by" } }),
      lot("d", "Uova", { expiry: { date: "2026-11-18", kind: "use_by" } }),
    ];
    const [line] = buildBriefing(make(events)).lines;
    expect(line.text).toBe("Oggi: Yogurt; Domani: 3 cose.");
    expect(line.certainty).toBe("label");
    expect(line.href).toBe("/app/ricette/idee");
  });

  it("una sola scadenza stimata porta a cosa cucinare con quell'alimento e dice che è una stima", () => {
    const events = [lot("a", "Pollo", { expiry: { date: "2026-11-18", kind: "estimated" } })];
    const [line] = buildBriefing(make(events)).lines;
    expect(line.text).toBe("Domani: Pollo.");
    expect(line.certainty).toBe("estimated");
    expect(line.href).toBe("/app/ricette/idee?alimento=Pollo");
  });

  it("il prossimo momento pianificato, con ciò che manca per cucinarlo", () => {
    const planned = [
      { meal: "breakfast" as const, text: "Yogurt" },
      { meal: "lunch" as const, text: "Pasta al pomodoro" },
    ];
    const b = buildBriefing(make([], { planned, missingForPlan: ["passata"], now: "2026-11-17T10:30:00Z" }));
    expect(b.lines[0].text).toBe("Pranzo: Pasta al pomodoro. Per il piano di oggi manca: passata.");
    expect(b.lines[0].href).toBe("/app/spesa");
    const ok = buildBriefing(make([], { planned, now: "2026-11-17T10:30:00Z" }));
    expect(ok.lines[0].href).toBe("/app/pasto?momento=lunch");
  });

  it("un momento già registrato o già passato non è «il prossimo»", () => {
    const events = [meal("m1", "2026-11-17T07:30:00Z", { mealId: "x", kind: "lunch" })];
    const planned = [{ meal: "lunch" as const, text: "Pasta" }];
    expect(buildBriefing(make(events, { planned })).lines).toEqual([]);
    const evening = buildBriefing(make([], { planned: [{ meal: "lunch", text: "Pasta" }], now: "2026-11-17T19:00:00Z" } as Partial<BriefingInput>));
    expect(evening.lines).toEqual([]);
  });

  it("acqua in ritardo solo per chi la usa, rispetto all'abitudine a quest'ora", () => {
    const days = ["10", "11", "12", "13", "14", "15", "16"];
    const habit = days.flatMap((d) => [
      water(`w1-${d}`, `2026-11-${d}T07:00:00Z`, { ml: 500 }),
      water(`w2-${d}`, `2026-11-${d}T20:00:00Z`, { ml: 500 }),
    ]);
    const line = buildBriefing(make(habit)).lines.find((l) => l.kind === "water");
    expect(line?.text).toBe("Acqua: finora 0 ml, di solito a quest'ora 500.");
    expect(line?.certainty).toBe("estimated");
    // chi non la usa non vede niente
    const few = habit.slice(0, 4);
    expect(buildBriefing(make(few)).lines).toEqual([]);
    // chi ha già bevuto abbastanza, neanche
    const drank = [...habit, water("wt", "2026-11-17T08:00:00Z", { ml: 400 })];
    expect(buildBriefing(make(drank)).lines.find((l) => l.kind === "water")).toBeUndefined();
  });

  it("un integratore abituale non ancora segnato", () => {
    const days = ["10", "11", "12", "13", "14", "15", "16"];
    const events = days.map((d) => supplement(`s-${d}`, `2026-11-${d}T06:00:00Z`, { name: "Vitamina D" }));
    const line = buildBriefing(make(events)).lines.find((l) => l.kind === "supplement");
    expect(line?.text).toBe("Vitamina D: oggi non risulta ancora segnato.");
    expect(line?.href).toBe("/app/salute");
  });

  it("un pasto di ieri senza registrazione, solo se ieri è stato registrato altro", () => {
    const some = [meal("m1", "2026-11-16T07:30:00Z", { mealId: "x", kind: "breakfast" })];
    const line = buildBriefing(make(some)).lines.find((l) => l.kind === "yesterday");
    expect(line?.text).toBe("Ieri nel registro mancano: pranzo e cena.");
    expect(line?.href).toBe("/app/pasto?momento=lunch&giorno=2026-11-16");
    expect(buildBriefing(make([])).lines).toEqual([]);
  });

  it("tutto insieme: al massimo tre righe, per urgenza, la coda a parte quando non c'è posto", () => {
    const events = [
      lot("a", "Yogurt", { expiry: { date: "2026-11-17", kind: "use_by" } }),
      lot("n", "Cose", { category: undefined }),
      meal("m1", "2026-11-16T07:30:00Z", { mealId: "x", kind: "breakfast" }),
    ];
    const b = buildBriefing(
      make(events, {
        planned: [{ meal: "lunch", text: "Pasta" }],
        missingForPlan: ["passata"],
        otherNotices: [{ key: "shopping:x", short: "Spesa: serve latte", url: "/app/spesa" }],
      }),
    );
    expect(b.lines).toHaveLength(MAX_LINES);
    expect(b.lines.map((l) => l.kind)).toEqual(["expiry", "plan", "yesterday"]);
    expect(b.reviewInLines).toBe(false);
    expect(b.reviewCount).toBe(1);
    expect(b.review[0].key).toBe("no_category:n");
  });

  it("la coda occupa l'ultima riga quando c'è posto", () => {
    const b = buildBriefing(make([lot("n", "Cose", { category: undefined })]));
    expect(b.lines).toHaveLength(1);
    expect(b.lines[0]).toMatchObject({ kind: "review", text: "1 cosa da rivedere", href: "#da-rivedere" });
    expect(b.reviewInLines).toBe(true);
  });
});

describe("da rivedere", () => {
  it("pasti «mangiato, non registrato» solo nei giorni passati, con l'azione che li registra", () => {
    const events = [
      declaration("d1", "2026-11-16T20:00:00Z", { date: "2026-11-16", kind: "lunch", status: "untracked" }),
      declaration("d2", "2026-11-17T08:00:00Z", { date: "2026-11-17", kind: "breakfast", status: "untracked" }),
      declaration("d3", "2026-11-15T20:00:00Z", { date: "2026-11-15", kind: "dinner", status: "skipped" }),
    ];
    const items = buildReviewItems(make(events));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ text: "Pranzo di ieri", href: "/app/pasto?momento=lunch&giorno=2026-11-16" });
  });

  it("scontrino: una voce per scontrino, dopo qualche giorno, e sparisce se il lotto è confermato", () => {
    const rec = { certainty: "estimated" as const, source: "receipt" as const, receiptId: "r1" };
    const events = [lot("a", "Pasta", rec), lot("b", "Riso", rec)];
    const [item] = buildReviewItems(make(events));
    expect(item.kind).toBe("provisional");
    expect(item.text).toBe("Scontrino di 7 giorni fa: 2 alimenti da controllare");
    expect(item.href).toBe("/app/dispensa/riallinea");
    // appena entrato: l'utente lo sta ancora rivedendo
    expect(buildReviewItems(make([lot("a", "Pasta", rec, "2026-11-16T08:00:00Z")]))).toEqual([]);
    // confermato con un riallineamento
    const confirmed = [...events, adjust("j", "2026-11-12T08:00:00Z", { lotId: "a", remaining: q(500) }), adjust("k", "2026-11-12T08:00:00Z", { lotId: "b", remaining: q(500) })];
    expect(buildReviewItems(make(confirmed))).toEqual([]);
  });

  it("lotto senza categoria e senza data stampata; con la data stampata no", () => {
    const items = buildReviewItems(make([lot("a", "Cose", { category: undefined }), lot("b", "Altro", { category: undefined, expiry: { date: "2026-12-30", kind: "best_before" } })]));
    expect(items.map((i) => i.key)).toEqual(["no_category:a"]);
  });

  it("quantità stimata dopo degli usi, mai riallineata", () => {
    const events = [
      lot("a", "Farina", {}, "2026-10-01T08:00:00Z"),
      consume("c1", "2026-10-05T08:00:00Z", { lotId: "a", quantity: q(100), certainty: "estimated" }),
    ];
    const items = buildReviewItems(make(events));
    expect(items.find((i) => i.kind === "quantity")?.text).toBe("Farina: quanto ne resta?");
    const adjusted = [...events, adjust("j", "2026-11-01T08:00:00Z", { lotId: "a", remaining: q(300) })];
    expect(buildReviewItems(make(adjusted)).find((i) => i.kind === "quantity")).toBeUndefined();
  });

  it("scadenza solo stimata da molto tempo su un lotto in casa; corretta o in freezer no", () => {
    const old = "2026-09-01T08:00:00Z";
    const est = { expiry: { date: "2026-10-01", kind: "estimated" as const } };
    const items = buildReviewItems(make([lot("a", "Salsa", est, old)]));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "stale_expiry", why: "La scadenza è solo una stima e risulta già passata." });
    const fixed = [lot("a", "Salsa", est, old), updateLot("u", "2026-11-10T08:00:00Z", { lotId: "a", patch: { expiry: { date: "2026-12-01", kind: "best_before" } } })];
    expect(buildReviewItems(make(fixed))).toEqual([]);
    expect(buildReviewItems(make([lot("a", "Salsa", { ...est, location: "freezer" }, old)]))).toEqual([]);
  });

  it("alimenti senza valori nutrizionali: solo se pesano (almeno 3 volte, di recente)", () => {
    const unresolvedFoods = [
      { key: "a", label: "Granola", count: 4, lastDate: "2026-11-15" },
      { key: "b", label: "Una volta", count: 1, lastDate: "2026-11-15" },
      { key: "c", label: "Vecchio", count: 9, lastDate: "2026-09-01" },
    ];
    const items = buildReviewItems(make([], { unresolvedFoods }));
    expect(items.map((i) => i.text)).toEqual(["Granola: usato 4 volte, senza valori nutrizionali"]);
    expect(items[0].href).toBe("/app/salute/nutrizione");
  });

  it("«Lascia così»: la voce non torna, e la lista ricordata è limitata", () => {
    const events = [lot("n", "Cose", { category: undefined })];
    expect(buildReviewItems(make(events, { dismissed: ["no_category:n"] }))).toEqual([]);
    expect(buildBriefing(make(events, { dismissed: ["no_category:n"] })).lines).toEqual([]);
    expect(rememberDismissed(["a"], "a")).toEqual(["a"]);
    expect(rememberDismissed(["a"], "b")).toEqual(["a", "b"]);
    expect(normalizeDismissed("x")).toEqual([]);
    expect(normalizeDismissed(Array.from({ length: 400 }, (_, i) => String(i)))).toHaveLength(300);
  });

  it("un lotto compare una volta sola", () => {
    const events = [lot("a", "Salsa", { category: undefined, expiry: { date: "2026-10-01", kind: "estimated" } }, "2026-09-01T08:00:00Z")];
    expect(buildReviewItems(make(events))).toHaveLength(1);
  });
});

describe("voci di sicurezza", () => {
  const prep = (over: Partial<PrepRecord> = {}): PrepRecord =>
    ({ prepId: "r1", title: "Ragù", status: "active", remaining: 3, batchLotId: "x", expiry: { date: "2026-11-17", kind: "use_by" }, ...over }) as PrepRecord;
  const preps = (...p: PrepRecord[]): PrepState => ({ preps: p, voidedPrepIds: [], anomalies: [], voidedEventIds: [] });

  it("un prodotto già scaduto compare in Oggi, prima di «scade oggi»", () => {
    const events = [
      lot("a", "Latte", { expiry: { date: "2026-11-16", kind: "use_by" } }),
      lot("b", "Yogurt", { expiry: { date: "2026-11-17", kind: "use_by" } }),
    ];
    const [line] = buildBriefing(make(events)).lines;
    expect(line.kind).toBe("expiry");
    expect(line.text).toBe("Scaduti: Latte; Oggi: Yogurt.");
    expect(line.href).toBe("/app/dispensa");
  });

  it("la scadenza stimata dalla sola categoria si dice, con il segno di stima", () => {
    const events = [lot("a", "Pollo", { category: "poultry" }, "2026-11-10T08:00:00Z")];
    const [line] = buildBriefing(make(events)).lines;
    expect(line.kind).toBe("expiry");
    expect(line.certainty).toBe("estimated");
  });

  it("la porzione di una preparazione che scade oggi è nella riga delle scadenze", () => {
    const events = [lot("x", "Ragù", { expiry: { date: "2026-11-17", kind: "use_by" } })];
    const [line] = buildBriefing(make(events, { preps: preps(prep()) })).lines;
    expect(line).toMatchObject({ kind: "expiry", text: "Oggi: Ragù.", href: "/app/preparazioni" });
  });

  it("nessuna voce di sicurezza resta fuori dalle tre righe a favore di acqua, integratori, piano, ieri o revisione", () => {
    const days = ["10", "11", "12", "13", "14", "15", "16"];
    const events = [
      lot("a", "Latte", { expiry: { date: "2026-11-16", kind: "use_by" } }),
      lot("x", "Ragù", { expiry: { date: "2026-11-17", kind: "use_by" } }),
      lot("n", "Cose", { category: undefined }),
      meal("m1", "2026-11-16T07:30:00Z", { mealId: "m", kind: "breakfast" }),
      ...days.flatMap((d) => [water(`w1-${d}`, `2026-11-${d}T07:00:00Z`, { ml: 500 }), water(`w2-${d}`, `2026-11-${d}T20:00:00Z`, { ml: 500 })]),
      ...days.map((d) => supplement(`s-${d}`, `2026-11-${d}T06:00:00Z`, { name: "Vitamina D" })),
    ];
    const b = buildBriefing(make(events, { preps: preps(prep()), planned: [{ meal: "breakfast", text: "Yogurt" }], missingForPlan: ["passata"] }));
    expect(b.lines).toHaveLength(MAX_LINES);
    expect(b.lines[0].kind).toBe("expiry");
    expect(b.lines[0].text).toBe("Scaduti: Latte; Oggi: Ragù.");
  });

  it("uno scaduto non passa dalla coda; la stima vecchia sì, con la data nella chiave", () => {
    const est = { expiry: { date: "2026-11-10", kind: "estimated" as const } };
    // scaduto da pochi giorni: lo dice il riepilogo, non la coda
    expect(buildReviewItems(make([lot("a", "Salsa", est, "2026-09-01T08:00:00Z")]))).toEqual([]);
    const old = { expiry: { date: "2026-09-20", kind: "estimated" as const } };
    const [item] = buildReviewItems(make([lot("a", "Salsa", old, "2026-09-01T08:00:00Z")]));
    expect(item.key).toBe("stale_expiry:a:2026-09-20");
  });
});
