import { describe, expect, it } from "vitest";
import { deriveDiary, type DiaryState } from "../diary";
import { supplement } from "../diary/test-helpers";
import { derivePantry, type PantryState } from "../ledger";
import { purchase, q } from "../ledger/test-helpers";
import { derivePlan } from "../plan";
import { prepEntry, weekEv } from "../plan/test-helpers";
import type { PrepRecord, PrepState } from "../prep";
import { DEFAULT_PREFS, normalizePrefs, withType } from "./prefs";
import { emptyLedger, recordShown } from "./ledger";
import { buildSavedSummary, composeMessage, planNotifications, previewNotices, summaryIsValid } from "./notify";
import type { NotifyInput, NotifyPrefs } from "./types";

// 2026-11-17 alle 10:00 a Roma (UTC+1).
const NOW = "2026-11-17T09:00:00Z";
const TODAY = "2026-11-17";

const on: NotifyPrefs = { ...DEFAULT_PREFS, enabled: true };

type LotSpec = { id: string; name: string; expiry?: { date: string; kind: "use_by" | "best_before" | "estimated" }; category?: string };

function pantryOf(lots: LotSpec[]): PantryState {
  return derivePantry(
    lots.map((l, i) =>
      purchase(`p${i}`, "2026-11-10T08:00:00Z", {
        lotId: l.id,
        productRef: l.name,
        quantity: q(500),
        location: "frigo",
        ...(l.expiry ? { expiry: l.expiry } : {}),
        ...(l.category ? { category: l.category } : {}),
      }),
    ),
  );
}

function input(over: Partial<NotifyInput> & { lots?: LotSpec[] } = {}): NotifyInput {
  const { lots, ...rest } = over;
  return { now: NOW, pantry: pantryOf(lots ?? []), prefs: on, ...rest };
}

describe("fatti di scadenza", () => {
  it("distingue la data stampata dalla stima", () => {
    const r = planNotifications(
      input({
        lots: [
          { id: "a", name: "Yogurt", expiry: { date: "2026-11-18", kind: "use_by" } },
          { id: "b", name: "Pollo", expiry: { date: "2026-11-18", kind: "estimated" } },
        ],
      }),
    );
    const yogurt = r.facts.find((f) => f.key.includes(":a:"));
    const pollo = r.facts.find((f) => f.key.includes(":b:"));
    expect(yogurt?.certainty).toBe("label");
    expect(yogurt?.text).toBe("Yogurt: scade domani.");
    expect(pollo?.certainty).toBe("estimated");
    expect(pollo?.text).toBe("Pollo: secondo la stima scade domani.");
    expect(pollo?.short).toContain("(stima)");
  });

  it("una data di qualità non allarma e una già passata non avvisa", () => {
    const r = planNotifications(
      input({
        lots: [
          { id: "a", name: "Biscotti", expiry: { date: "2026-11-17", kind: "best_before" } },
          { id: "b", name: "Cracker", expiry: { date: "2026-11-01", kind: "best_before" } },
        ],
      }),
    );
    expect(r.facts).toHaveLength(1);
    expect(r.facts[0].level).toBe("soon");
    expect(r.facts[0].text).toBe("Biscotti: da mangiare preferibilmente entro oggi.");
  });

  it("oggi, domani, entro N giorni e scaduti da poco", () => {
    const lots: LotSpec[] = [
      { id: "scaduto", name: "Latte", expiry: { date: "2026-11-16", kind: "use_by" } },
      { id: "oggi", name: "Burro", expiry: { date: "2026-11-17", kind: "use_by" } },
      { id: "tre", name: "Uova", expiry: { date: "2026-11-20", kind: "use_by" } },
      { id: "lontano", name: "Riso", expiry: { date: "2026-12-30", kind: "use_by" } },
      { id: "vecchio", name: "Salsa", expiry: { date: "2026-08-01", kind: "use_by" } },
    ];
    const r = planNotifications(input({ lots }));
    expect(r.facts.map((f) => f.text)).toEqual([
      "Latte: scaduto ieri.",
      "Burro: scade oggi.",
      "Uova: scade tra 3 giorni.",
    ]);
    const narrow = planNotifications(input({ lots, prefs: { ...on, expiryDaysAhead: 1 } }));
    expect(narrow.facts.map((f) => f.text)).toEqual(["Latte: scaduto ieri.", "Burro: scade oggi."]);
  });

  it("senza data né categoria non dice nulla", () => {
    const r = planNotifications(input({ lots: [{ id: "a", name: "Cose" }] }));
    expect(r.facts).toEqual([]);
    expect(r.message).toBeNull();
    expect(r.hold).toBe("nothing");
  });

  it("una stima dalla categoria è sempre presentata come stima", () => {
    const r = planNotifications(input({ lots: [{ id: "a", name: "Pollo", category: "poultry" }], now: "2026-11-12T09:00:00Z" }));
    expect(r.facts.length).toBeGreaterThan(0);
    expect(r.facts.every((f) => f.certainty === "estimated")).toBe(true);
    expect(r.facts[0].text).toContain("secondo la stima");
  });
});

describe("preparazioni", () => {
  const prep = (over: Partial<PrepRecord> = {}): PrepRecord =>
    ({
      prepId: "r1",
      title: "Ragù",
      status: "active",
      remaining: 3,
      batchLotId: "a",
      expiry: { date: "2026-11-18", kind: "estimated" },
      ...over,
    }) as PrepRecord;
  const preps = (...p: PrepRecord[]): PrepState => ({ preps: p, voidedPrepIds: [], anomalies: [], voidedEventIds: [] });

  it("le porzioni hanno un solo avviso, come preparazione", () => {
    const r = planNotifications(
      input({ lots: [{ id: "a", name: "Ragù", expiry: { date: "2026-11-18", kind: "estimated" } }], preps: preps(prep()) }),
    );
    expect(r.facts).toHaveLength(1);
    expect(r.facts[0].type).toBe("prep");
    expect(r.facts[0].text).toBe("Ragù: 3 porzioni, secondo la stima da mangiare entro domani.");
  });

  it("finite o senza porzioni non avvisano", () => {
    const r = planNotifications(input({ preps: preps(prep({ remaining: 0 }), prep({ prepId: "r2", status: "finished" })) }));
    expect(r.facts).toEqual([]);
  });
});

describe("deduplica e riepilogo", () => {
  const lots: LotSpec[] = [
    { id: "a", name: "Yogurt", expiry: { date: "2026-11-18", kind: "use_by" } },
    { id: "b", name: "Burro", expiry: { date: "2026-11-17", kind: "use_by" } },
    { id: "c", name: "Uova", expiry: { date: "2026-11-19", kind: "use_by" } },
  ];

  it("più fatti diventano un solo riepilogo", () => {
    const r = planNotifications(input({ lots }));
    expect(r.message?.digest).toBe(true);
    expect(r.message?.count).toBe(3);
    expect(r.message?.title).toBe("Da guardare oggi: 3 cose");
    expect(r.message?.body.split("\n")).toEqual(["Burro, oggi", "Yogurt, domani", "Uova, tra 2 giorni"]);
    expect(r.message?.url).toBe("/app/dispensa");
  });

  it("un solo fatto resta un avviso con il suo testo", () => {
    const r = planNotifications(input({ lots: lots.slice(1, 2) }));
    expect(r.message?.digest).toBe(false);
    expect(r.message).toMatchObject({ title: "Scade oggi", body: "Burro: scade oggi." });
  });

  it("molti fatti: il riepilogo resta breve", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ id: `l${i}`, name: `Cibo ${i}`, expiry: { date: "2026-11-18", kind: "use_by" as const } }));
    const r = planNotifications(input({ lots: many }));
    expect(r.message?.body.split("\n")).toHaveLength(5);
    expect(r.message?.body.endsWith("e altri 3")).toBe(true);
  });

  it("non ripete un fatto già mostrato, ma i nuovi sì", () => {
    const first = planNotifications(input({ lots }));
    const shown = recordShown(emptyLedger(), first.message!, TODAY, NOW);
    const again = planNotifications(input({ lots, shown, now: "2026-11-17T15:00:00Z" }));
    expect(again.message).toBeNull();
    expect(again.due).toEqual([]);
    expect(again.facts).toHaveLength(3);
    const more = planNotifications(
      input({
        lots: [...lots, { id: "d", name: "Latte", expiry: { date: "2026-11-17", kind: "use_by" } }],
        shown,
        now: "2026-11-17T15:00:00Z",
      }),
    );
    expect(more.due.map((f) => f.short)).toEqual(["Latte, oggi"]);
    expect(more.message?.digest).toBe(false);
  });

  it("lo stesso fatto non torna il giorno dopo nella stessa fase", () => {
    const l: LotSpec[] = [{ id: "u", name: "Uova", expiry: { date: "2026-11-20", kind: "use_by" } }];
    const first = planNotifications(input({ lots: l }));
    const shown = recordShown(emptyLedger(), first.message!, TODAY, NOW);
    const next = planNotifications(input({ lots: l, shown, now: "2026-11-18T09:00:00Z" }));
    expect(next.due).toEqual([]);
    const later = planNotifications(input({ lots: l, shown, now: "2026-11-19T09:00:00Z" }));
    expect(later.due).toHaveLength(1); // ora è "domani": un fatto nuovo
  });

  it("al massimo due notifiche al giorno, distanziate", () => {
    const l1: LotSpec[] = [{ id: "a", name: "Yogurt", expiry: { date: "2026-11-18", kind: "use_by" } }];
    let shown = recordShown(emptyLedger(), { keys: ["x"] }, TODAY, "2026-11-17T07:00:00Z");
    const l2: LotSpec[] = [...l1];
    expect(planNotifications(input({ lots: l2, shown, now: "2026-11-17T08:00:00Z" })).hold).toBe("too_soon");
    expect(planNotifications(input({ lots: l2, shown, now: "2026-11-17T12:00:00Z" })).message).not.toBeNull();
    shown = recordShown(shown, { keys: ["y"] }, TODAY, "2026-11-17T12:00:00Z");
    expect(planNotifications(input({ lots: l2, shown, now: "2026-11-17T17:00:00Z" })).hold).toBe("daily_limit");
  });

  it("composeMessage senza fatti non produce nulla", () => {
    expect(composeMessage([], TODAY)).toBeNull();
  });
});

describe("preferenze e ore di silenzio", () => {
  const lots: LotSpec[] = [{ id: "a", name: "Yogurt", expiry: { date: "2026-11-17", kind: "use_by" } }];

  it("spenti: nessun avviso ma l'anteprima resta", () => {
    const r = planNotifications(input({ lots, prefs: DEFAULT_PREFS }));
    expect(r.message).toBeNull();
    expect(r.hold).toBe("disabled");
    expect(previewNotices(input({ lots, prefs: DEFAULT_PREFS }))).toHaveLength(1);
  });

  it("un tipo spento non produce fatti", () => {
    const r = planNotifications(input({ lots, prefs: withType(on, "expiry", false) }));
    expect(r.facts).toEqual([]);
  });

  it("di notte non avvisa, ma i fatti restano da mostrare", () => {
    const r = planNotifications(input({ lots, now: "2026-11-17T22:30:00Z" })); // 23:30 a Roma
    expect(r.hold).toBe("quiet");
    expect(r.message).toBeNull();
    expect(r.due).toHaveLength(1);
    expect(planNotifications(input({ lots, now: "2026-11-17T06:30:00Z" })).hold).toBe("quiet"); // 07:30
    expect(planNotifications(input({ lots, now: "2026-11-17T07:00:00Z" })).message).not.toBeNull(); // 08:00
  });

  it("silenzio spento: avvisa anche di notte", () => {
    const prefs: NotifyPrefs = { ...on, quietHours: { ...on.quietHours, enabled: false } };
    expect(planNotifications(input({ lots, prefs, now: "2026-11-17T22:30:00Z" })).message).not.toBeNull();
  });

  it("un fuso diverso cambia l'ora locale", () => {
    // 09:00Z sono le 05:00 a New York: ore di silenzio
    expect(planNotifications(input({ lots, timeZone: "America/New_York" })).hold).toBe("quiet");
  });

  it("normalizePrefs ripara ciò che non è valido", () => {
    expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS);
    const p = normalizePrefs({ enabled: true, types: { expiry: false, plan: "x" }, quietHours: { from: "25:00", to: "07:30" }, expiryDaysAhead: 99 });
    expect(p.enabled).toBe(true);
    expect(p.types.expiry).toBe(false);
    expect(p.types.plan).toBe(DEFAULT_PREFS.types.plan);
    expect(p.quietHours).toMatchObject({ from: "22:00", to: "07:30" });
    expect(p.expiryDaysAhead).toBe(3);
  });
});

describe("integratori", () => {
  const dayAt = (d: number, hhmm = "07:30") => `2026-11-${String(d).padStart(2, "0")}T${hhmm}:00Z`; // 08:30 a Roma
  const taken = (days: number[], name = "Vitamina D"): DiaryState =>
    deriveDiary(days.map((d) => supplement(`s${d}`, dayAt(d), { name })));

  it("avvisa se è abituale e oggi non risulta, dopo l'ora usuale", () => {
    const r = planNotifications(input({ diary: taken([10, 11, 12, 13, 14, 15]) }));
    expect(r.facts).toHaveLength(1);
    expect(r.facts[0]).toMatchObject({ type: "supplement", certainty: "recorded", text: "Vitamina D: oggi non risulta ancora segnato." });
  });

  it("non avvisa se oggi è già segnato", () => {
    const r = planNotifications(input({ diary: taken([10, 11, 12, 13, 14, 15, 17]) }));
    expect(r.facts).toEqual([]);
  });

  it("non avvisa senza abitudine: pochi giorni sono dati mancanti, non una regola", () => {
    expect(planNotifications(input({ diary: taken([14, 15, 16]) })).facts).toEqual([]);
    expect(planNotifications(input({ diary: deriveDiary([]) })).facts).toEqual([]);
  });

  it("non avvisa prima dell'ora usuale né troppo tardi", () => {
    const d = taken([10, 11, 12, 13, 14, 15]);
    expect(planNotifications(input({ diary: d, now: "2026-11-17T07:00:00Z" })).facts).toEqual([]); // 08:00
    expect(planNotifications(input({ diary: d, now: "2026-11-17T19:00:00Z" })).facts).toEqual([]); // 20:00
  });
});

describe("spesa e piano", () => {
  it("senza storico sufficiente la spesa non avvisa", () => {
    const r = planNotifications(input({ lots: [{ id: "a", name: "Pasta" }], prefs: { ...on, types: { ...on.types, shopping: true } } }));
    expect(r.facts).toEqual([]);
  });

  it("settimana prossima vuota: solo nel fine settimana e solo se il piano è già in uso", () => {
    const plan = derivePlan([weekEv("w1", "2026-11-09T08:00:00Z", "2026-11-09", [prepEntry("2026-11-10", "lunch", "r1")])]);
    const prefs: NotifyPrefs = { ...on, types: { ...on.types, plan: true } };
    const sat = planNotifications(input({ plan, prefs, now: "2026-11-14T09:00:00Z" }));
    expect(sat.facts.map((f) => f.key)).toContain("plan:week:2026-11-16");
    expect(planNotifications(input({ plan, prefs, now: "2026-11-11T09:00:00Z" })).facts).toEqual([]);
    expect(planNotifications(input({ plan: derivePlan([]), prefs, now: "2026-11-14T09:00:00Z" })).facts).toEqual([]);
  });
});

describe("riepilogo salvato per il service worker", () => {
  const lots: LotSpec[] = [{ id: "a", name: "Yogurt", expiry: { date: "2026-11-18", kind: "use_by" } }];

  it("prepara il giorno dopo quando oggi è già stato detto", () => {
    const shown = recordShown(emptyLedger(), planNotifications(input({ lots })).message!, TODAY, NOW);
    const s = buildSavedSummary(input({ lots, shown }));
    expect(s?.forDay).toBe("2026-11-18");
    expect(s?.message.body).toBe("Yogurt: scade oggi.");
  });

  it("tiene per oggi ciò che era dovuto ma di notte non si è potuto mostrare", () => {
    const s = buildSavedSummary(input({ lots, now: "2026-11-17T22:30:00Z" }));
    expect(s?.forDay).toBe("2026-11-17");
    expect(s?.message.keys).toHaveLength(1);
  });

  it("niente se gli avvisi sono spenti o non c'è nulla da dire", () => {
    expect(buildSavedSummary(input({ lots, prefs: DEFAULT_PREFS }))).toBeNull();
    expect(buildSavedSummary(input({ lots: [] }))).toBeNull();
  });

  it("scade: un altro giorno o dopo la scadenza non è valido", () => {
    const s = buildSavedSummary(input({ lots, now: "2026-11-17T22:30:00Z" }))!;
    expect(summaryIsValid(s, "2026-11-17T23:00:00Z", "2026-11-17")).toBe(true);
    expect(summaryIsValid(s, "2026-11-18T09:00:00Z", "2026-11-18")).toBe(false);
    expect(summaryIsValid(s, "2026-11-19T12:00:00Z", "2026-11-17")).toBe(false);
  });
});

describe("più confezioni uguali: un solo fatto, con il numero", () => {
  const mousse = (id: string, date = "2026-11-20") => ({ id, name: "Mousse cacao protein", expiry: { date, kind: "use_by" as const } });

  it("due confezioni con la stessa data fanno un fatto solo", () => {
    const r = planNotifications(input({ lots: [mousse("a"), mousse("b")] }));
    expect(r.facts).toHaveLength(1);
    expect(r.facts[0].text).toBe("Mousse cacao protein: 2 confezioni scadono tra 3 giorni.");
    expect(r.facts[0].short).toBe("Mousse cacao protein (2 confezioni), tra 3 giorni");
    expect(r.message?.digest).toBe(false);
  });

  it("una confezione con la data diversa resta un fatto distinto", () => {
    const r = planNotifications(input({ lots: [mousse("a"), mousse("b"), mousse("c", "2026-11-19")] }));
    expect(r.facts.map((f) => f.text).sort()).toEqual([
      "Mousse cacao protein: 2 confezioni scadono tra 3 giorni.",
      "Mousse cacao protein: scade tra 2 giorni.",
    ]);
  });

  it("la chiave non dipende dall'ordine e non cambia aggiungendo un'altra confezione uguale", () => {
    const one = planNotifications(input({ lots: [mousse("a")] })).facts[0].key;
    const two = planNotifications(input({ lots: [mousse("b"), mousse("a")] })).facts[0].key;
    const three = planNotifications(input({ lots: [mousse("c"), mousse("a"), mousse("b")] })).facts[0].key;
    expect(two).toBe(one);
    expect(three).toBe(one);
  });

  it("un fatto già mostrato non si ripete quando arriva un'altra confezione uguale", () => {
    const first = planNotifications(input({ lots: [mousse("a")] }));
    const shown = recordShown(emptyLedger(), first.message!, TODAY, "2026-11-17T07:00:00Z");
    const later = planNotifications(input({ lots: [mousse("a"), mousse("b")], shown, now: "2026-11-17T18:00:00Z" }));
    expect(later.due).toEqual([]);
  });

  it("stessa data ma natura diversa (data stampata e stima) non si fondono", () => {
    const r = planNotifications(
      input({
        lots: [
          { id: "a", name: "Pollo", expiry: { date: "2026-11-18", kind: "use_by" } },
          { id: "b", name: "Pollo", expiry: { date: "2026-11-18", kind: "estimated" } },
        ],
      }),
    );
    expect(r.facts).toHaveLength(2);
  });

  it("scadute: «2 confezioni scadute ieri»", () => {
    const r = planNotifications(input({ lots: [mousse("a", "2026-11-16"), mousse("b", "2026-11-16")] }));
    expect(r.facts[0].text).toBe("Mousse cacao protein: 2 confezioni scadute ieri.");
  });
});
