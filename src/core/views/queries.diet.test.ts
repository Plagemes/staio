import { describe, expect, it } from "vitest";
import type { DietHistory, Indicator, WeekFrame } from "../diet/types";
import { QUERY_CATALOG, getQuery } from "./catalog";
import { runQuery } from "./run";
import { validateView } from "./validate";
import { EMPTY_CONTEXT, buildContext } from "./test-helpers";
import type { ParamValue, QueryResult, ViewContext } from "./types";

const WEEK_STARTS = ["2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"];

function legumes(value: number | undefined, over: Partial<Indicator> = {}): Indicator {
  return {
    id: "group:legumes",
    ...(value !== undefined ? { value } : {}),
    unit: "servingsPerWeek",
    lowerBound: false,
    certainty: "estimated",
    coverage: 0.9,
    status: value === undefined ? "insufficient" : "below",
    target: { kind: "perWeek", min: 2, max: 4, row: "legumes", source: "crea-lg-2018", where: "Tab. 9.1, p. 132" },
    ...over,
  };
}

function processed(status: Indicator["status"], share?: number): Indicator {
  return { id: "processedShare", unit: "share", lowerBound: false, certainty: "estimated", coverage: 0.9, status, ...(share !== undefined ? { value: share } : {}) };
}

function frame(weekStart: string, indicators: Indicator[], over: Partial<WeekFrame> = {}): WeekFrame {
  const share = indicators.find((i) => i.id === "processedShare")?.value;
  const end = new Date(Date.parse(`${weekStart}T00:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10);
  return {
    weekStart,
    weekEnd: end,
    inProgress: false,
    daysElapsed: 7,
    daysWithData: 6,
    completeDays: 5,
    coverage: { lines: 30, classifiedLines: 25, estimatedLines: 5, energyKcal: 12000, classifiedKcal: 10000, share: 0.83 },
    tallies: {} as WeekFrame["tallies"],
    rowTallies: {} as WeekFrame["rowTallies"],
    salt: { completeDays: 5, missingShare: 0, partial: false },
    fiber: { completeDays: 5, missingShare: 0, partial: false },
    freeSugars: { grams: 10, lowerBound: true, certainty: "estimated" },
    processed: { nova4Kcal: 2000, knownKcal: 9000, totalKcal: 10000, ...(share !== undefined ? { share } : {}), coverage: 0.9, certainty: "estimated" },
    plantVariety: { count: 12, partial: false },
    gaps: [],
    indicators,
    ...over,
  };
}

/** Nove settimane: la più vecchia e la quinta senza dati sufficienti, l'ultima in corso. */
function history(): DietHistory {
  const values: (number | undefined)[] = [undefined, 1, 2, 3, undefined, 1, 3, 1, 2];
  const weeks = WEEK_STARTS.map((s, i) =>
    frame(s, [legumes(values[i], i === 8 ? { lowerBound: true, status: "atLeast" } : {}), processed(i === 3 ? "insufficient" : "noTarget", i === 3 ? undefined : 0.2 + i / 100)], i === 8 ? { inProgress: true, daysElapsed: 3, daysWithData: 3 } : {}),
  );
  return { level: 2000, weeks, trends: {}, daily: {} };
}

const ctxWith = (diet?: DietHistory): ViewContext => buildContext(undefined, { diet });

function exec(name: string, given: Record<string, ParamValue> = {}, ctx: ViewContext = ctxWith(history())): QueryResult {
  const def = getQuery(name);
  if (!def) throw new Error(`manca ${name}`);
  const params: Record<string, ParamValue> = {};
  for (const [key, p] of Object.entries(def.params)) {
    if (given[key] !== undefined) params[key] = given[key];
    else if (p.kind !== "text" && p.default !== undefined) params[key] = p.default;
  }
  return runQuery({ name, params }, ctx).result;
}

describe("qualità di ciò che si mangia: nel catalogo", () => {
  it("le tre interrogazioni sono registrate e richiedono i nutrienti", () => {
    for (const name of ["quality_group_frequency", "quality_processed_share", "quality_week_overview"]) {
      expect(getQuery(name)?.needsNutrition).toBe(true);
      expect(QUERY_CATALOG.filter((q) => q.name === name)).toHaveLength(1);
    }
  });

  it("una vista che le usa passa il validatore esistente", () => {
    const r = validateView({
      title: "Legumi nelle settimane",
      blocks: [{ type: "chart", query: { name: "quality_group_frequency", params: { group: "legumes", weeks: 6 } } }],
    });
    expect(r.ok).toBe(true);
    const bad = validateView({
      title: "Prova",
      blocks: [{ type: "chart", query: { name: "quality_group_frequency", params: { group: "non_esiste", weeks: 6 } } }],
    });
    expect(bad.ok).toBe(false);
  });

  it("senza il quadro dei pasti dicono «dati insufficienti», anche con parametri vuoti", () => {
    for (const name of ["quality_group_frequency", "quality_processed_share", "quality_week_overview"]) {
      expect(exec(name, { group: "legumes" }, EMPTY_CONTEXT).kind).toBe("insufficient");
      expect(exec(name, {}, EMPTY_CONTEXT).kind).toBe("insufficient");
    }
    expect((exec("quality_group_frequency", {}, EMPTY_CONTEXT) as { reason: string }).reason).toMatch(/^Dati insufficienti/);
  });
});

describe("quality_group_frequency", () => {
  it("dà le ultime settimane, con una lacuna dove i dati non bastano", () => {
    const r = exec("quality_group_frequency", { group: "legumes", weeks: 8 });
    if (r.kind !== "series") throw new Error("attesa una serie");
    expect(r.points).toHaveLength(8);
    expect(r.points.map((p) => p.value)).toEqual([1, 2, 3, null, 1, 3, 1, 2]);
    expect(r.points[7].label).toBe("16/11 (in corso)");
    expect(r.unit).toBe("porzioni a settimana");
    expect(r.basis).toBe("7 settimane con dati sufficienti su 8");
    expect(r.note).toMatch(/minimo/);
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity|undefined/);
  });

  it("rispetta il numero di settimane chieste", () => {
    const r = exec("quality_group_frequency", { group: "legumes", weeks: 4 });
    if (r.kind !== "series") throw new Error("attesa una serie");
    expect(r.points.map((p) => p.value)).toEqual([1, 3, 1, 2]);
  });

  it("senza nessuna settimana sufficiente non dà numeri", () => {
    const h = history();
    const empty: DietHistory = { ...h, weeks: h.weeks.map((w) => ({ ...w, indicators: [legumes(undefined)] })) };
    expect(exec("quality_group_frequency", { group: "legumes" }, ctxWith(empty)).kind).toBe("insufficient");
  });

  it("un gruppo che non c'è tra gli indicatori non vale zero", () => {
    expect(exec("quality_group_frequency", { group: "fish" }).kind).toBe("insufficient");
  });

  it("un gruppo sconosciuto non lancia", () => {
    expect(exec("quality_group_frequency", { group: "zzz" }).kind).toBe("insufficient");
  });
});

describe("quality_processed_share", () => {
  it("dà la quota in percentuale dell'energia, con la copertura nella nota", () => {
    const r = exec("quality_processed_share", { weeks: 8 });
    if (r.kind !== "series") throw new Error("attesa una serie");
    expect(r.unit).toBe("% dell'energia");
    expect(r.points).toHaveLength(8);
    expect(r.points[0].value).toBe(21);
    expect(r.points[2].value).toBe(null);
    expect(r.certainty).toBe("estimated");
    expect(r.note).toContain("90%");
  });

  it("senza quote note dice che i dati non bastano", () => {
    const h = history();
    const none: DietHistory = { ...h, weeks: h.weeks.map((w) => ({ ...w, indicators: [processed("insufficient")] })) };
    expect(exec("quality_processed_share", {}, ctxWith(none)).kind).toBe("insufficient");
  });
});

describe("quality_week_overview", () => {
  it("0 è la settimana in corso: righe con valore e stato in parole", () => {
    const r = exec("quality_week_overview", { week: 0 });
    if (r.kind !== "rows") throw new Error("attese righe");
    const row = r.rows.find((x) => x.label === "Legumi");
    expect(row?.valueText).toBe("almeno 2 porzioni a settimana");
    expect(row?.detail).toContain("settimana registrata in parte");
    expect(row?.detail).toContain("da 2 a 4 a settimana");
    expect(r.basis).toContain("3 giorni registrati su 3");
    expect(r.note).toMatch(/non un parere medico/);
  });

  it("1 è la scorsa: sotto l'indicazione, senza voti", () => {
    const r = exec("quality_week_overview", { week: 1 });
    if (r.kind !== "rows") throw new Error("attese righe");
    expect(r.rows[0].detail).toContain("sotto l'indicazione");
    expect(r.rows.find((x) => x.label === "Prodotti molto lavorati")?.detail).toBe("nessuna soglia ufficiale: solo il tuo andamento");
    expect(JSON.stringify(r)).not.toMatch(/sano|voto|punteggio|devi/i);
  });

  it("un indicatore insufficiente lo dice e non dà un valore", () => {
    const r = exec("quality_week_overview", { week: 9 });
    expect(r.kind).toBe("insufficient");
    const h = history();
    const lacking: DietHistory = { ...h, weeks: [...h.weeks.slice(0, 7), frame("2026-11-09", [legumes(undefined, { insufficient: "few_days" })]), h.weeks[8]] };
    const r2 = exec("quality_week_overview", { week: 1 }, ctxWith(lacking));
    if (r2.kind !== "rows") throw new Error("attese righe");
    expect(r2.rows[0].valueText).toBe("dati insufficienti");
    expect(r2.rows[0].detail).toBe("dati insufficienti: pochi giorni registrati");
  });

  it("una settimana senza giorni registrati non dà righe", () => {
    const h = history();
    const empty: DietHistory = { ...h, weeks: [...h.weeks.slice(0, 8), { ...h.weeks[8], daysWithData: 0 }] };
    expect(exec("quality_week_overview", { week: 0 }, ctxWith(empty)).kind).toBe("insufficient");
  });
});
