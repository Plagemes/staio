import { describe, expect, it } from "vitest";
import { compareExperiment, createExperiment, deriveExperiments, validateExperimentEvent } from "@/core/analysis";
import {
  adherenceLines,
  adherencePatch,
  anomalyText,
  archivePatch,
  autocorrelationLines,
  buildExperimentEvent,
  buildExperimentUpdate,
  canCloseEarly,
  closeEarlyPatch,
  differenceText,
  emptyExperimentForm,
  experimentStatus,
  measureMissingText,
  multiplicityText,
  parseExperimentForm,
  progressText,
  referencePeriod,
  renamePatch,
  restorePatch,
  splitExperiments,
  splitFoods,
  verdictText,
  weightAutocorrelationText,
} from "./experimentsView";
import { analyze, dateOf, day, moodOn, noise, rng } from "@/core/analysis/test-helpers";
import { voidEvent } from "@/core/ledger";
import { buildIntervalPlot } from "./charts";

const TODAY = "2026-03-20";

const valid = () => ({
  ...emptyExperimentForm(TODAY),
  title: "Senza caffè dopo pranzo",
  change: "Niente caffè dopo le 14",
  measures: ["mood" as const, "weight" as const],
});

let counter = 0;
function stored(overrides: Partial<ReturnType<typeof validBody>> = {}, recordedAt = "2026-03-10T10:00:00.000Z") {
  return createExperiment({ ...validBody(), ...overrides }, { deviceId: "dev", now: () => recordedAt, idGenerator: () => `id-${++counter}` });
}
function validBody() {
  return {
    experimentId: "exp-1",
    title: "Senza latte",
    change: "Niente latte",
    startDate: "2026-03-15",
    endDate: "2026-03-28",
    measures: ["mood" as const],
  };
}

describe("stato e avanzamento", () => {
  const e = { startDate: "2026-03-15", endDate: "2026-03-28" };
  it("programmato, in corso, concluso", () => {
    expect(experimentStatus(e, "2026-03-14")).toBe("upcoming");
    expect(experimentStatus(e, "2026-03-15")).toBe("ongoing");
    expect(experimentStatus(e, "2026-03-28")).toBe("ongoing");
    expect(experimentStatus(e, "2026-03-29")).toBe("ended");
  });
  it("testo di avanzamento", () => {
    expect(progressText(e, "2026-03-18")).toBe("Giorno 4 di 14");
    expect(progressText(e, "2026-03-14")).toBe("Inizia domani");
    expect(progressText(e, "2026-03-10")).toBe("Inizia tra 5 giorni");
    expect(progressText(e, "2026-03-30")).toMatch(/^Concluso da 2 giorni/);
  });
  it("il periodo di riferimento è lungo come l'esperimento e lo precede", () => {
    expect(referencePeriod("2026-03-15", "2026-03-28")).toEqual({ from: "2026-03-01", to: "2026-03-14", days: 14 });
  });
  it("divide gli esperimenti in corso e conclusi", () => {
    const list = deriveExperiments([
      stored({ experimentId: "a", startDate: "2026-03-01", endDate: "2026-03-05" }),
      stored({ experimentId: "b", startDate: "2026-03-18", endDate: "2026-03-30" }),
      stored({ experimentId: "c", startDate: "2026-03-25", endDate: "2026-04-01" }),
    ]).experiments;
    const { active, ended } = splitExperiments(list, "2026-03-20");
    expect(active.map((x) => x.experimentId)).toEqual(["b", "c"]);
    expect(ended.map((x) => x.experimentId)).toEqual(["a"]);
  });
});

describe("modulo di creazione", () => {
  it("predefiniti: oggi per quattordici giorni", () => {
    const f = emptyExperimentForm(TODAY);
    expect(f.startDate).toBe("2026-03-20");
    expect(f.endDate).toBe("2026-04-02");
  });

  it("un modulo valido dà un corpo che il motore accetta", () => {
    const r = parseExperimentForm(valid(), TODAY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.measures).toEqual(["mood", "weight"]);
    const event = buildExperimentEvent(r.body, { deviceId: "dev" });
    expect(validateExperimentEvent(event)).toEqual([]);
  });

  it("messaggi in italiano per ogni campo sbagliato", () => {
    const r = parseExperimentForm({ ...emptyExperimentForm(TODAY), startDate: "", endDate: "" }, TODAY);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.title).toMatch(/titolo/);
    expect(r.errors.change).toMatch(/cambi/);
    expect(r.errors.startDate).toBeDefined();
    expect(r.errors.endDate).toBeDefined();
    expect(r.errors.measures).toMatch(/almeno una misura/);
  });

  it("rifiuta una fine prima dell'inizio e un esperimento già finito", () => {
    const before = parseExperimentForm({ ...valid(), startDate: "2026-03-25", endDate: "2026-03-24" }, TODAY);
    expect(!before.ok && before.errors.endDate).toMatch(/prima dell'inizio/);
    const past = parseExperimentForm({ ...valid(), startDate: "2026-03-01", endDate: "2026-03-10" }, TODAY);
    expect(!past.ok && past.errors.endDate).toMatch(/già finito/);
  });

  it("gli alimenti esclusi si separano e non si ripetono", () => {
    expect(splitFoods("caffè, Caffè; tè nero\n  ,")).toEqual(["caffè", "tè nero"]);
  });
});

describe("chiusura, annullamento, ripristino, rinomina, aderenza: eventi parziali", () => {
  const original = stored({}, "2026-03-10T10:00:00.000Z");
  const exp = deriveExperiments([original]).experiments[0];
  const opts = (iso: string) => ({ deviceId: "dev", now: () => iso });

  it("si chiude in anticipo solo se in corso e non ancora finito", () => {
    expect(canCloseEarly(exp, "2026-03-14")).toBe(false);
    expect(canCloseEarly(exp, "2026-03-20")).toBe(true);
    expect(canCloseEarly(exp, "2026-03-28")).toBe(false);
    expect(closeEarlyPatch(exp, "2026-03-14")).toBeUndefined();
  });

  it("la chiusura anticipata dichiara solo la chiusura: l'ultimo giorno diventa oggi", () => {
    const patch = closeEarlyPatch(exp, "2026-03-20");
    expect(patch).toEqual({ closedOn: "2026-03-20" });
    const closing = buildExperimentUpdate(exp.experimentId, patch!, opts("2026-03-20T09:00:00.000Z"));
    expect(Object.keys(closing).filter((k) => ["title", "change", "startDate", "endDate", "measures", "archived"].includes(k))).toEqual([]);
    const state = deriveExperiments([original, closing]);
    expect(state.experiments).toHaveLength(1);
    expect(state.experiments[0]).toMatchObject({ endDate: "2026-03-20", plannedEndDate: "2026-03-28", closedEarly: true });
    // l'originale non è stato toccato
    expect(original.endDate).toBe("2026-03-28");
  });

  it("annullare la chiusura (void) riporta l'esperimento com'era", () => {
    const closing = buildExperimentUpdate(exp.experimentId, closeEarlyPatch(exp, "2026-03-20")!, opts("2026-03-20T09:00:00.000Z"));
    const undo = voidEvent(closing, { deviceId: "dev", now: () => "2026-03-20T09:00:05.000Z" });
    expect(deriveExperiments([original, closing, undo]).experiments[0].endDate).toBe("2026-03-28");
  });

  it("l'annullamento ritira l'esperimento, il ripristino lo riporta, e il void del ripristino lo ritira di nuovo", () => {
    const archived = buildExperimentUpdate(exp.experimentId, archivePatch(), opts("2026-03-20T09:00:00.000Z"));
    expect(deriveExperiments([original, archived]).experiments).toEqual([]);
    const undo = voidEvent(archived, { deviceId: "dev", now: () => "2026-03-20T09:01:00.000Z" });
    expect(deriveExperiments([original, archived, undo]).experiments).toHaveLength(1);
    const restored = buildExperimentUpdate(exp.experimentId, restorePatch(), opts("2026-03-21T09:00:00.000Z"));
    expect(deriveExperiments([original, archived, restored]).experiments).toHaveLength(1);
    const undoRestore = voidEvent(restored, { deviceId: "dev", now: () => "2026-03-21T09:01:00.000Z" });
    expect(deriveExperiments([original, archived, restored, undoRestore]).experiments).toEqual([]);
  });

  it("l'aderenza dichiarata si aggiunge e si toglie senza toccare il resto", () => {
    const withAdh = buildExperimentUpdate(exp.experimentId, adherencePatch(0.75), opts("2026-03-21T09:00:00.000Z"));
    expect(withAdh).not.toHaveProperty("title");
    const s1 = deriveExperiments([original, withAdh]).experiments[0];
    expect(s1.declaredAdherence).toBe(0.75);
    expect(s1.title).toBe(exp.title);
    const cleared = buildExperimentUpdate(exp.experimentId, adherencePatch(undefined), opts("2026-03-22T09:00:00.000Z"));
    expect(deriveExperiments([original, withAdh, cleared]).experiments[0].declaredAdherence).toBeUndefined();
  });

  it("la rinomina dichiara solo ciò che è cambiato e rifiuta testi vuoti", () => {
    const onlyTitle = renamePatch(exp, "Altro titolo", exp.change);
    expect(onlyTitle).toEqual({ ok: true, patch: { title: "Altro titolo" } });
    const both = renamePatch(exp, " Nuovo ", "Nuova descrizione");
    expect(both).toEqual({ ok: true, patch: { title: "Nuovo", change: "Nuova descrizione" } });
    expect(renamePatch(exp, exp.title, exp.change)).toMatchObject({ ok: false, errors: { nothing: expect.any(String) } });
    expect(renamePatch(exp, "  ", exp.change)).toMatchObject({ ok: false, errors: { title: expect.any(String) } });
    expect(renamePatch(exp, exp.title, "")).toMatchObject({ ok: false, errors: { change: expect.any(String) } });
    const event = buildExperimentUpdate(exp.experimentId, (onlyTitle.ok ? onlyTitle.patch : {}), opts("2026-03-22T09:00:00.000Z"));
    expect(deriveExperiments([original, event]).experiments[0]).toMatchObject({ title: "Altro titolo", change: exp.change });
  });

  it("i tre casi del revisore con gli eventi scritti dalle schermate", () => {
    // 1. A chiude in anticipo, B (non sincronizzato) rinomina: la chiusura resta.
    const closing = buildExperimentUpdate(exp.experimentId, closeEarlyPatch(exp, "2026-03-20")!, opts("2026-03-20T09:00:00.000Z"));
    const rename = buildExperimentUpdate(exp.experimentId, { title: "Rinominato da B" }, { deviceId: "B", now: () => "2026-03-20T10:00:00.000Z" });
    const merged = deriveExperiments([rename, original, closing]).experiments[0];
    expect(merged).toMatchObject({ title: "Rinominato da B", endDate: "2026-03-20" });
    // 2. A annulla, B aggiorna l'aderenza: resta annullato.
    const archive = buildExperimentUpdate(exp.experimentId, archivePatch(), opts("2026-03-20T09:00:00.000Z"));
    const adherence = buildExperimentUpdate(exp.experimentId, adherencePatch(0.5), { deviceId: "B", now: () => "2026-03-20T09:30:00.000Z" });
    const after = deriveExperiments([original, adherence, archive]);
    expect(after.experiments).toEqual([]);
    expect(after.archived[0].declaredAdherence).toBe(0.5);
    // 3. Orologio di B avanti: la rinomina "futura" non cancella la chiusura né l'annullamento.
    const futureRename = buildExperimentUpdate(exp.experimentId, { title: "B in avanti" }, { deviceId: "B", now: () => "2026-03-25T09:00:00.000Z" });
    const s3 = deriveExperiments([original, futureRename, closing, archive]);
    expect(s3.archived[0]).toMatchObject({ title: "B in avanti", endDate: "2026-03-20" });
  });

  it("si vede l'anomalia di una chiusura in conflitto, in italiano", () => {
    const a = buildExperimentUpdate(exp.experimentId, { closedOn: "2026-03-20" }, opts("2026-03-20T09:00:00.000Z"));
    const b = buildExperimentUpdate(exp.experimentId, { closedOn: "2026-03-18" }, { deviceId: "B", now: () => "2026-03-18T09:00:00.000Z" });
    const state = deriveExperiments([original, a, b]);
    expect(state.experiments[0].endDate).toBe("2026-03-18");
    const conflict = state.anomalies.find((x) => x.code === "closure_conflict")!;
    const text = anomalyText(conflict, () => exp.title);
    expect(text).toMatch(/concluso in giorni diversi/);
    expect(text).toMatch(/vale il giorno più vicino all'inizio/);
    expect(text).toContain(exp.title);
  });

  it("modifica orfana: spiegata, non mostrata come esperimento", () => {
    const orphan = buildExperimentUpdate("fantasma", { title: "x" }, opts("2026-03-20T09:00:00.000Z"));
    const state = deriveExperiments([orphan]);
    expect(state.experiments).toEqual([]);
    expect(anomalyText(state.anomalies[0], () => undefined)).toMatch(/non esiste più/);
  });
});

describe("testi del confronto", () => {
  function compared(asOf = dateOf(28)) {
    const random = rng(5);
    const events: unknown[] = [];
    for (let i = 0; i < 28; i++) {
      events.push(...day(i, { kcal: 2000 + noise(random, 80) }));
      events.push(moodOn(i, i >= 14 ? 4 + (i % 2) : 2 + (i % 2)));
    }
    const { diary, intakeDays } = analyze(events);
    const experiment = deriveExperiments([
      createExperiment(
        { experimentId: "x", title: "t", change: "c", startDate: dateOf(14), endDate: dateOf(27), measures: ["mood", "weight"] },
        { deviceId: "d" },
      ),
    ]).experiments[0];
    return compareExperiment(experiment, { diary, intakeDays }, { asOf });
  }

  it("la differenza si mostra sempre con il suo intervallo", () => {
    const c = compared();
    expect(c.status).toBe("ok");
    if (c.status !== "ok") return;
    const mood = c.measures.find((m) => m.measure === "mood");
    expect(mood?.status).toBe("compared");
    if (mood?.status !== "compared") return;
    expect(differenceText(mood)).toMatch(/^\+[\d,]+ punti \(tra [+−][\d,]+ e \+[\d,]+, al 95%\)$/);
    expect(verdictText(mood)).toMatch(/Più alto del riferimento, distinguibile/);
  });

  it("una misura senza dati dice quanti ne servono ancora e in quale periodo", () => {
    const c = compared();
    if (c.status !== "ok") throw new Error("atteso ok");
    const weight = c.measures.find((m) => m.measure === "weight");
    expect(weight?.status).toBe("insufficient");
    if (weight?.status !== "insufficient") return;
    const lines = measureMissingText(weight).join(" ");
    expect(lines).toMatch(/0 pesate su 6/);
    expect(lines).toMatch(/ne mancano ancora 6/);
  });

  it("l'aderenza dichiara cosa non si sa", () => {
    const c = compared();
    if (c.status !== "ok") throw new Error("atteso ok");
    const text = adherenceLines(c.adherence).join(" ");
    expect(text).toMatch(/Non hai dichiarato/);
    expect(text).toMatch(/Non hai indicato alimenti da escludere/);
  });

  it("un risultato provvisorio non produce mai il testo «distinguibile» né una direzione", () => {
    // l'esperimento va dal giorno 14 al 27; oggi è il giorno 22: in corso
    const c = compared(dateOf(22));
    expect(c.status).toBe("ok");
    if (c.status !== "ok") return;
    expect(c.provisional).toBe(true);
    const compare = c.measures.filter((m): m is Extract<typeof m, { status: "compared" }> => m.status === "compared");
    expect(compare.length).toBeGreaterThan(0);
    for (const m of compare) {
      expect(m.verdict).toBe("provisional");
      expect(m.direction).toBeUndefined();
      expect(verdictText(m)).toBe("Provvisorio: l'esperimento è in corso");
      const plot = buildIntervalPlot(m.difference, m.interval.low, m.interval.high, m.unit, 2, 300, m.provisional);
      for (const text of [verdictText(m), differenceText(m), plot.description, multiplicityText(c.multiplicity, true)]) {
        expect(text).not.toMatch(/distingu/i);
        expect(text).not.toMatch(/più (alto|basso) del riferimento/i);
      }
    }
  });

  it("un verdetto nuovo non compila: il controllo di esaustività sui tipi", () => {
    type Compared = Extract<Parameters<typeof differenceText>[0], { verdict: string }>;
    const all: Compared["verdict"][] = ["distinguishable", "not_distinguishable", "provisional"];
    const text = (v: Compared["verdict"]): string => {
      switch (v) {
        case "distinguishable":
        case "not_distinguishable":
        case "provisional":
          return v;
        default: {
          const never: never = v;
          return never;
        }
      }
    };
    expect(all.map(text)).toEqual(all);
  });

  it("una riga dice quante misure sono state confrontate insieme e che la soglia ne tiene conto", () => {
    const c = compared();
    if (c.status !== "ok") throw new Error("atteso ok");
    const text = multiplicityText({ ...c.multiplicity, measuresRequested: 3, measuresCompared: 3 }, false);
    expect(text).toMatch(/3 misure confrontate insieme/);
    expect(text).toMatch(/Holm/);
    expect(text).toMatch(/al massimo 1%|al massimo \d+%/);
    expect(multiplicityText({ ...c.multiplicity, measuresRequested: 2, measuresCompared: 1 }, false)).toMatch(/1 misure confrontate su 2 richieste|1 misura|su 2 richieste/);
  });

  it("l'autocorrelazione si spiega in parole semplici con il numero efficace", () => {
    const c = compared();
    if (c.status !== "ok") throw new Error("atteso ok");
    const mood = c.measures.find((m) => m.measure === "mood");
    if (mood?.status !== "compared") throw new Error("atteso confronto");
    const text = autocorrelationLines(mood).join(" ");
    expect(text).toMatch(/giorni vicini tendono a somigliarsi/);
    expect(text).toMatch(/osservazioni indipendenti/);
    expect(text).toMatch(/Valore p/);
    expect(weightAutocorrelationText({ rho: 0.4, pairs: 20 })).toMatch(/0,4, su 20 coppie/);
  });
});
