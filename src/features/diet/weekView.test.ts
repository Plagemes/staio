import { describe, expect, it } from "vitest";
import { CURRENT, LAST_CLOSED, frame, history, ind } from "@/core/diet/advice/test-helpers";
import type { AdviceOutcome, WeekFrame } from "@/core/diet";
import {
  gapViews,
  historyIsEmpty,
  indicatorViews,
  insufficientNote,
  isShown,
  outcomeViews,
  parseWeekParam,
  periodLabel,
  pickWeek,
  ruleTexts,
  sourcesUsed,
  splitEstimate,
  trendDirection,
  trendPoints,
  trendSummary,
  weekNav,
} from "./weekView";

const TODAY = "2026-11-25";

describe("parseWeekParam", () => {
  it("porta una data valida al lunedì della sua settimana", () => {
    expect(parseWeekParam("2026-11-18")).toBe("2026-11-16");
    expect(parseWeekParam("2026-11-16")).toBe("2026-11-16");
    expect(parseWeekParam("2026-11-22")).toBe("2026-11-16");
  });
  it("scarta ciò che non è una data", () => {
    expect(parseWeekParam(null)).toBeUndefined();
    expect(parseWeekParam("")).toBeUndefined();
    expect(parseWeekParam("ieri")).toBeUndefined();
    expect(parseWeekParam("2026-02-30")).toBeUndefined();
    expect(parseWeekParam("2026-13-01")).toBeUndefined();
  });
});

describe("pickWeek e weekNav", () => {
  const h = history();
  it("senza richiesta sceglie la settimana in corso", () => {
    expect(pickWeek(h.weeks, undefined)?.frame.weekStart).toBe(CURRENT);
  });
  it("sceglie la settimana chiesta", () => {
    expect(pickWeek(h.weeks, LAST_CLOSED)?.frame.weekStart).toBe(LAST_CLOSED);
  });
  it("una settimana futura porta a quella in corso, una troppo vecchia alla prima", () => {
    expect(pickWeek(h.weeks, "2027-01-04")?.frame.weekStart).toBe(CURRENT);
    expect(pickWeek(h.weeks, "2020-01-06")?.index).toBe(0);
  });
  it("senza settimane non sceglie niente", () => {
    expect(pickWeek([], undefined)).toBeUndefined();
  });
  it("le frecce: la prima settimana non ha «prima», l'ultima non ha «dopo»", () => {
    const first = weekNav(h.weeks, 0);
    expect(first.prev).toBeUndefined();
    expect(first.next?.href).toContain("settimana=");
    const last = weekNav(h.weeks, h.weeks.length - 1);
    expect(last.next).toBeUndefined();
    expect(last.prev?.label).toMatch(/^Settimana prima: /);
  });
  it("tornando alla settimana in corso l'indirizzo non ha parametro", () => {
    const nav = weekNav(h.weeks, h.weeks.length - 2);
    expect(nav.next?.href).toBe("/app/salute/mangiato");
    expect(nav.prev?.href).toContain(`settimana=${h.weeks[h.weeks.length - 3].weekStart}`);
  });
});

describe("periodLabel", () => {
  it("dice questa settimana, scorsa o la data", () => {
    expect(periodLabel({ weekStart: CURRENT }, TODAY)).toBe("Questa settimana");
    expect(periodLabel({ weekStart: LAST_CLOSED }, TODAY)).toBe("Settimana scorsa");
    expect(periodLabel({ weekStart: "2026-11-09" }, TODAY)).toBe("Settimana del 9 nov");
  });
});

describe("historyIsEmpty", () => {
  it("è vuota solo se nessuna settimana ha giorni registrati", () => {
    expect(historyIsEmpty({ weeks: [frame({ weekStart: LAST_CLOSED, daysWithData: 0 })] })).toBe(true);
    expect(historyIsEmpty(history())).toBe(false);
  });
});

describe("isShown e indicatorViews", () => {
  it("nasconde gli zeri senza una distanza da colmare, non quelli «sotto»", () => {
    expect(isShown(ind("group:legumes", "below", 0))).toBe(true);
    expect(isShown(ind("group:redMeat", "within", 0))).toBe(false);
    expect(isShown(ind("group:snacksChocolate", "occasional", 0))).toBe(false);
    expect(isShown(ind("group:alcohol", "occasional", 9))).toBe(true);
  });

  it("mette prima «sotto», poi «sopra», poi «almeno», poi il resto; gli stati sono scritti in parole", () => {
    const h = history({
      indicators: [ind("group:legumes", "below", 1), ind("group:fish", "within", 2), ind("group:nutsSeeds", "above", 9), ind("group:redMeat", "atLeast", 0.5, { lowerBound: true })],
    });
    const views = indicatorViews(h.weeks, h.weeks.length - 2);
    const order = views.map((v) => v.id);
    expect(order.indexOf("group:legumes")).toBeLessThan(order.indexOf("group:nutsSeeds"));
    expect(order.indexOf("group:nutsSeeds")).toBeLessThan(order.indexOf("group:redMeat"));
    expect(order.indexOf("group:redMeat")).toBeLessThan(order.indexOf("group:fish"));
    const legumes = views.find((v) => v.id === "group:legumes");
    expect(legumes?.status).toBe("sotto l'indicazione");
    expect(legumes?.shape).toBe("ring");
    expect(legumes?.label).toBe("Legumi");
    expect(legumes?.target).toBe("indicate 2–4 porzioni a settimana");
    expect(views.find((v) => v.id === "group:nutsSeeds")?.shape).toBe("dot");
    expect(views.find((v) => v.id === "group:fish")?.shape).toBe("none");
  });

  it("le stime portano la tilde e il minimo «almeno»", () => {
    const h = history({ indicators: [ind("group:legumes", "atLeast", 1, { lowerBound: true, certainty: "estimated" })] });
    const v = indicatorViews(h.weeks, h.weeks.length - 2).find((x) => x.id === "group:legumes");
    expect(v?.estimated).toBe(true);
    expect(v?.value).toBe("almeno ~1 porzione a settimana");
  });

  it("nessun testo dice «devi», «dovresti» o «sano»", () => {
    const h = history();
    for (const v of indicatorViews(h.weeks, h.weeks.length - 2)) {
      expect(`${v.value} ${v.status} ${v.target ?? ""} ${v.trend?.summary ?? ""}`).not.toMatch(/\bdevi\b|dovresti|\bsano\b|voto|punteggio/i);
    }
  });
});

describe("andamento", () => {
  const withLegumes = (values: (number | null)[]): WeekFrame[] =>
    values.map((v, i) =>
      frame({
        weekStart: `2026-0${1 + Math.floor(i / 4)}-${String(5 + (i % 4) * 7).padStart(2, "0")}`,
        ...(v === null ? { daysWithData: 2, indicators: [ind("group:legumes", "insufficient")] } : { indicators: [ind("group:legumes", "within", v)] }),
      }),
    );

  it("una lacuna resta vuota, mai zero, e non entra nell'andamento", () => {
    const weeks = withLegumes([1, null, 2, 3, 3]);
    const points = trendPoints("group:legumes", weeks, weeks.length - 1);
    expect(points.map((p) => p.value)).toEqual([1, null, 2, 3, 3]);
    expect(points[1].text).toBe("dati insufficienti");
    expect(trendDirection(points)).toBe("up");
  });

  it("al più otto settimane, fino a quella scelta", () => {
    const weeks = withLegumes([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(trendPoints("group:legumes", weeks, 9)).toHaveLength(8);
    expect(trendPoints("group:legumes", weeks, 2)).toHaveLength(3);
  });

  it("la settimana in corso e un minimo si disegnano vuoti e non contano nell'andamento", () => {
    const h = history({}, { closedWeeks: 4, current: { daysWithData: 5, indicators: [ind("group:legumes", "atLeast", 1, { lowerBound: true })] } });
    const points = trendPoints("group:legumes", h.weeks, h.weeks.length - 1);
    const last = points[points.length - 1];
    expect(last.partial).toBe(true);
    expect(last.text.startsWith("in corso: ")).toBe(true);
    expect(trendDirection(points.slice(-1))).toBe("insufficient");
  });

  it("il riassunto per il lettore dice quante settimane hanno dati e la direzione", () => {
    const weeks = withLegumes([1, null, 2, 3, 3]);
    const points = trendPoints("group:legumes", weeks, 4);
    const text = trendSummary("Legumi", points);
    expect(text).toContain("Legumi, ultime 5 settimane: 4 con dati");
    expect(text).toContain("in aumento");
    expect(trendSummary("Legumi", points.map((p) => ({ ...p, value: null })))).toContain("nessuna con dati sufficienti");
  });

  it("la riga ha l'andamento solo con almeno due settimane con dati", () => {
    const h = history();
    const rows = indicatorViews(h.weeks, h.weeks.length - 2);
    expect(rows.find((r) => r.id === "group:legumes")?.trend?.points.length).toBeGreaterThan(1);
    const single = indicatorViews([h.weeks[h.weeks.length - 2]], 0);
    expect(single.every((r) => r.trend === undefined)).toBe(true);
  });
});

describe("insufficientNote", () => {
  it("c'è solo se la settimana non basta, e dice i giorni", () => {
    expect(insufficientNote(frame({ weekStart: LAST_CLOSED }))).toBeUndefined();
    const few = frame({ weekStart: LAST_CLOSED, daysWithData: 2, indicators: [ind("group:legumes", "insufficient", 1, { insufficient: "few_days" })] });
    expect(insufficientNote(few)).toBe("Dati insufficienti: 2 giorni su 7");
  });
});

describe("outcomeViews", () => {
  it("i più recenti per primi, al più quattro", () => {
    const h = history();
    const mk = (weekStart: string): AdviceOutcome => ({ ruleId: "legumesLow", weekStart, nextWeekStart: weekStart, before: 1, after: 3, result: "moved" });
    const views = outcomeViews([mk("2026-10-05"), mk("2026-10-12"), mk("2026-10-19"), mk("2026-10-26"), mk("2026-11-02")], h);
    expect(views).toHaveLength(4);
    expect(views[0].text).toContain("2 nov");
  });
});

describe("gapViews", () => {
  it("scrive la voce, il giorno e il perché, e dà un nome al collegamento", () => {
    const [g] = gapViews([{ lineKey: "e1#0", date: "2026-11-18", label: "Cracker integrali", reason: "unknown" }]);
    expect(g.text).toBe("Cracker integrali · 18 nov: non riconosciuto");
    expect(g.label).toBe("Controlla «Cracker integrali», 18 nov");
  });
});

describe("come è calcolato", () => {
  it("le regole riportano le soglie vere", () => {
    const text = ruleTexts().join(" ");
    expect(text).toContain("almeno 4 giorni");
    expect(text).toContain("70%");
    expect(text).toContain("6 giorni e 80%");
  });
  it("le fonti: sempre la scelta dell'app, poi quelle degli indicatori e dei consigli, senza doppioni", () => {
    const f = frame({ weekStart: LAST_CLOSED });
    const ids = sourcesUsed(f, ["crea-lg-2018", "ownTrend", "who-salt"]);
    expect(ids).toContain("app");
    expect(ids).toContain("crea-lg-2018");
    expect(ids).toContain("who-salt");
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("splitEstimate", () => {
  it("separa la tilde dal resto", () => {
    expect(splitEstimate("almeno ~3 volte")).toEqual([
      { tilde: false, text: "almeno " },
      { tilde: true, text: "~" },
      { tilde: false, text: "3 volte" },
    ]);
    expect(splitEstimate("3 volte")).toEqual([{ tilde: false, text: "3 volte" }]);
  });
});
