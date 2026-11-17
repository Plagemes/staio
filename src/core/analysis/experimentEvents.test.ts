import { describe, expect, it } from "vitest";
import { voidOf } from "../diary/test-helpers";
import {
  InvalidExperimentEventError,
  compareExperiment,
  createExperiment,
  deriveExperiments,
  isFullExperimentEvent,
  updateExperiment,
  validateExperimentEvent,
  type ExperimentBody,
  type ExperimentEvent,
  type ExperimentPatch,
} from "./experiments";
import { analyze, dateOf, day, moodOn, rng, shuffled } from "./test-helpers";

const BODY: ExperimentBody = {
  experimentId: "exp",
  title: "Senza latte",
  change: "Niente latte",
  startDate: dateOf(14),
  endDate: dateOf(27),
  measures: ["mood"],
  excludedFoods: ["latte"],
};

let n = 0;
const stamp = (minutes: number): string => new Date(Date.UTC(2026, 2, 1, 8, minutes)).toISOString();
const full = (recordedAt: string, over: Partial<ExperimentBody> = {}) =>
  createExperiment({ ...BODY, ...over }, { deviceId: "A", now: () => recordedAt, idGenerator: () => `f${++n}` });
const patch = (p: ExperimentPatch, recordedAt: string, deviceId = "A", experimentId = "exp") =>
  updateExperiment(experimentId, p, { deviceId, now: () => recordedAt, idGenerator: () => `u${++n}` });
const only = (events: unknown[]) => deriveExperiments(events).experiments[0];

describe("eventi parziali: validazione", () => {
  it("un evento parziale dichiara solo ciò che cambia; uno intero resta valido", () => {
    const u = patch({ archived: true }, stamp(1));
    expect(isFullExperimentEvent(u)).toBe(false);
    expect(validateExperimentEvent(u)).toEqual([]);
    expect(isFullExperimentEvent(full(stamp(0)))).toBe(true);
  });

  it("un evento senza alcuna modifica non è valido", () => {
    expect(() => patch({}, stamp(1))).toThrow(InvalidExperimentEventError);
    expect(validateExperimentEvent({ ...patch({ archived: true }, stamp(1)), archived: undefined })).toContainEqual({
      path: "",
      code: "empty_patch",
    });
  });

  it("controlla i tipi dei campi dichiarati", () => {
    const u = patch({ archived: true }, stamp(1)) as unknown as Record<string, unknown>;
    const bad = (extra: Record<string, unknown>) => validateExperimentEvent({ ...u, ...extra });
    expect(bad({ closedOn: "2026-02-30" })).toContainEqual({ path: "closedOn", code: "invalid_date" });
    expect(bad({ archived: "sì" })).toContainEqual({ path: "archived", code: "invalid_type" });
    expect(bad({ declaredAdherence: 2 })).toContainEqual({ path: "declaredAdherence", code: "invalid_value" });
    expect(bad({ title: " " })).toContainEqual({ path: "title", code: "invalid_type" });
    expect(bad({ excludedFoods: ["x"] })).toContainEqual({ path: "excludedFoods", code: "not_allowed" });
    expect(bad({ declaredAdherence: null })).toEqual([]);
    // Un evento con l'inizio ma senza il resto è un evento intero incompleto.
    expect(bad({ startDate: dateOf(1) })).toContainEqual({ path: "endDate", code: "required" });
  });
});

describe("unione tra dispositivi, campo per campo", () => {
  const creation = full(stamp(0));

  it("esempio 1: A chiude in anticipo, B (non sincronizzato) rinomina: la chiusura resta", () => {
    const closing = patch({ closedOn: dateOf(20) }, stamp(10), "A");
    const rename = patch({ title: "Nuovo titolo" }, stamp(20), "B");
    for (const order of [[creation, closing, rename], [creation, rename, closing], [rename, closing, creation]]) {
      const e = only(order);
      expect(e.title).toBe("Nuovo titolo");
      expect(e.endDate).toBe(dateOf(20));
      expect(e.closedEarly).toBe(true);
      expect(e.plannedEndDate).toBe(dateOf(27));
    }
  });

  it("esempio 2: A annulla, B aggiorna l'aderenza: l'esperimento resta annullato", () => {
    const archive = patch({ archived: true }, stamp(10), "A");
    const adherence = patch({ declaredAdherence: 0.75 }, stamp(20), "B");
    const state = deriveExperiments([creation, archive, adherence]);
    expect(state.experiments).toEqual([]);
    expect(state.archived).toHaveLength(1);
    expect(state.archived[0].declaredAdherence).toBe(0.75);
    // Il ripristino è un evento esplicito, e il suo void riporta l'annullamento.
    const restore = patch({ archived: false }, stamp(30), "A");
    expect(deriveExperiments([creation, archive, adherence, restore]).experiments).toHaveLength(1);
    const undoRestore = voidOf("v-restore", stamp(31), restore.id);
    expect(deriveExperiments([creation, archive, adherence, restore, undoRestore]).experiments).toEqual([]);
  });

  it("esempio 3: un orologio in avanti non fa vincere una modifica vecchia sugli altri campi", () => {
    // B ha l'orologio avanti di un'ora e rinomina PRIMA che A chiuda (in tempo reale).
    const rename = patch({ title: "Titolo di B" }, stamp(90), "B");
    const closing = patch({ closedOn: dateOf(20) }, stamp(30), "A");
    const archive = patch({ archived: true }, stamp(31), "A");
    const e = deriveExperiments([creation, rename, closing, archive]);
    expect(e.experiments).toEqual([]);
    expect(e.archived[0]).toMatchObject({ title: "Titolo di B", endDate: dateOf(20), closedEarly: true });
  });

  it("due chiusure diverse: vale la più vicina all'inizio e si segnala il conflitto", () => {
    const a = patch({ closedOn: dateOf(22) }, stamp(10), "A");
    const b = patch({ closedOn: dateOf(18) }, stamp(5), "B");
    for (const order of [[creation, a, b], [b, a, creation]]) {
      const state = deriveExperiments(order);
      expect(state.experiments[0].endDate).toBe(dateOf(18));
      const conflicts = state.anomalies.filter((x) => x.code === "closure_conflict");
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toMatchObject({ experimentId: "exp", applied: dateOf(18) });
      expect(conflicts[0].closures?.map((c) => c.closedOn)).toEqual([dateOf(18), dateOf(22)]);
    }
    // Annullando la chiusura che non vale il conflitto sparisce.
    const state = deriveExperiments([creation, a, b, voidOf("v", stamp(40), b.id)]);
    expect(state.experiments[0].endDate).toBe(dateOf(22));
    expect(state.anomalies.filter((x) => x.code === "closure_conflict")).toEqual([]);
    // La stessa chiusura da due dispositivi non è un conflitto.
    const same = deriveExperiments([creation, patch({ closedOn: dateOf(20) }, stamp(1)), patch({ closedOn: dateOf(20) }, stamp(2), "B")]);
    expect(same.anomalies).toEqual([]);
  });

  it("una chiusura prima dell'inizio è ignorata e segnalata; dopo la fine prevista non cambia nulla", () => {
    const early = patch({ closedOn: dateOf(10) }, stamp(10));
    const late = patch({ closedOn: dateOf(40) }, stamp(11));
    const state = deriveExperiments([creation, early, late]);
    expect(state.experiments[0]).toMatchObject({ endDate: dateOf(27), closedEarly: false });
    expect(state.anomalies.map((x) => x.code)).toEqual(["invalid_closure"]);
  });

  it("titolo e descrizione: vale l'ultima dichiarazione di ciascuno, indipendentemente", () => {
    const t1 = patch({ title: "T1", change: "C1" }, stamp(1));
    const t2 = patch({ title: "T2" }, stamp(3));
    const c2 = patch({ change: "C2" }, stamp(2));
    const e = only([creation, t2, c2, t1]);
    expect(e).toMatchObject({ title: "T2", change: "C2" });
  });

  it("l'aderenza si toglie con null senza toccare il resto", () => {
    const set = patch({ declaredAdherence: 0.5 }, stamp(1));
    const clear = patch({ declaredAdherence: null }, stamp(2));
    expect(only([creation, set]).declaredAdherence).toBe(0.5);
    expect(only([creation, set, clear]).declaredAdherence).toBeUndefined();
  });

  it("compatibilità: un evento intero già scritto vale come modifica dei suoi campi", () => {
    const legacyClose = full(stamp(10), { endDate: dateOf(20) });
    const legacyRename = full(stamp(20), { endDate: dateOf(20), title: "Rinominato" });
    const e = only([creation, legacyClose, legacyRename]);
    expect(e).toMatchObject({ title: "Rinominato", endDate: dateOf(20), plannedEndDate: dateOf(20), closedEarly: false });
    // Un evento intero non cancella un'archiviazione se non la dichiara.
    const archive = patch({ archived: true }, stamp(30));
    expect(deriveExperiments([creation, archive, full(stamp(40), { title: "Dopo" })]).experiments).toEqual([]);
    // Un evento intero che la dichiara (anche false) vale.
    expect(deriveExperiments([creation, archive, full(stamp(40), { archived: false })]).experiments).toHaveLength(1);
  });
});

describe("senza creazione l'esperimento non esiste", () => {
  it("annullare la creazione non lascia vive le modifiche successive", () => {
    const creation = full(stamp(0));
    const adherence = patch({ declaredAdherence: 0.9 }, stamp(10));
    const rename = patch({ title: "Altro" }, stamp(11));
    const undoCreation = voidOf("v-c", stamp(20), creation.id);
    const state = deriveExperiments([creation, adherence, rename, undoCreation]);
    expect(state.experiments).toEqual([]);
    expect(state.archived).toEqual([]);
    expect(state.anomalies.map((a) => [a.code, a.eventId])).toEqual([
      ["orphan_update", adherence.id],
      ["orphan_update", rename.id],
    ]);
  });

  it("modifiche senza alcuna creazione: anomalie, non stato", () => {
    const state = deriveExperiments([patch({ title: "Solo modifica" }, stamp(1), "A", "fantasma")]);
    expect(state.experiments).toEqual([]);
    expect(state.anomalies).toMatchObject([{ code: "orphan_update", experimentId: "fantasma" }]);
  });

  it("annullare una modifica la toglie; annullare la creazione di un esperimento ne lascia altri intatti", () => {
    const creation = full(stamp(0));
    const other = full(stamp(1), { experimentId: "altro" });
    const rename = patch({ title: "Nuovo" }, stamp(5));
    expect(only([creation, rename, voidOf("v", stamp(6), rename.id)]).title).toBe(BODY.title);
    const state = deriveExperiments([creation, other, voidOf("v2", stamp(7), creation.id)]);
    expect(state.experiments.map((e) => e.experimentId)).toEqual(["altro"]);
  });
});

describe("indipendenza dall'ordine", () => {
  it("permutazioni casuali a seme fisso (con duplicati) danno sempre lo stesso stato", () => {
    const creation = full(stamp(0));
    const other = full(stamp(1), { experimentId: "altro", startDate: dateOf(3), endDate: dateOf(9) });
    const events: unknown[] = [
      creation,
      other,
      patch({ title: "T-A" }, stamp(10), "A"),
      patch({ title: "T-B" }, stamp(12), "B"),
      patch({ change: "C-B" }, stamp(11), "B"),
      patch({ closedOn: dateOf(22) }, stamp(13), "A"),
      patch({ closedOn: dateOf(19) }, stamp(14), "B"),
      patch({ archived: true }, stamp(15), "A"),
      patch({ archived: false }, stamp(16), "B"),
      patch({ declaredAdherence: 0.5 }, stamp(17), "A"),
      patch({ declaredAdherence: null }, stamp(18), "B"),
      patch({ title: "orfano" }, stamp(19), "A", "senza-creazione"),
      full(stamp(20), { experimentId: "legacy", title: "Intero" }),
    ];
    const toVoid = events[3] as ExperimentEvent;
    events.push(voidOf("v-1", stamp(21), toVoid.id), voidOf("v-2", stamp(22), (events[9] as ExperimentEvent).id));
    const expected = deriveExperiments(events);
    expect(expected.experiments.length).toBeGreaterThan(0);
    expect(expected.anomalies.map((a) => a.code)).toEqual(expect.arrayContaining(["closure_conflict", "orphan_update"]));
    const random = rng(2026);
    for (let k = 0; k < 120; k++) {
      const permuted = shuffled([...events, ...events.slice(0, k % 7)], random);
      expect(deriveExperiments(permuted)).toEqual(expected);
    }
  });
});

describe("giorno di fine", () => {
  function setup(closedOn?: string) {
    const events: unknown[] = [];
    for (let i = 0; i < 28; i++) {
      events.push(...day(i));
      events.push(moodOn(i, 3));
    }
    const { diary, intakeDays } = analyze(events);
    const list: unknown[] = [full(stamp(0), { excludedFoods: [] })];
    if (closedOn) list.push(patch({ closedOn }, stamp(5)));
    return { diary, intakeDays, experiment: only(list) };
  }

  it("fino al giorno di fine compreso il risultato è provvisorio, ma il giorno conta se è già completo", () => {
    const { diary, intakeDays, experiment } = setup();
    const onLastDay = compareExperiment(experiment, { diary, intakeDays }, { asOf: dateOf(27) });
    if (onLastDay.status !== "ok") throw new Error("atteso ok");
    expect(onLastDay.provisional).toBe(true);
    expect(onLastDay.periods.experiment.to).toBe(dateOf(27));
    // Il giorno di fine ha i tre pasti tracciati: conta tra i giorni completi.
    expect(onLastDay.periods.experiment.completeDays).toBe(14);

    // Il giorno di fine non ancora completo (manca la cena) non conta e il verdetto non è definitivo.
    const partial: unknown[] = [];
    for (let i = 0; i < 28; i++) {
      partial.push(...day(i, i === 27 ? { skip: ["dinner"] } : {}));
      partial.push(moodOn(i, 3));
    }
    const p = analyze(partial);
    const incomplete = compareExperiment(experiment, p, { asOf: dateOf(27) });
    if (incomplete.status !== "ok") throw new Error("atteso ok");
    expect(incomplete.provisional).toBe(true);
    expect(incomplete.periods.experiment.completeDays).toBe(13);

    // Concluso solo dal giorno successivo.
    const next = compareExperiment(experiment, { diary, intakeDays }, { asOf: dateOf(28) });
    if (next.status !== "ok") throw new Error("atteso ok");
    expect(next.provisional).toBe(false);
  });

  it("chiusura anticipata oggi: il periodo si ferma a oggi, definitivo dal giorno dopo", () => {
    const { diary, intakeDays, experiment } = setup(dateOf(20));
    expect(experiment.endDate).toBe(dateOf(20));
    const today = compareExperiment(experiment, { diary, intakeDays }, { asOf: dateOf(20) });
    if (today.status !== "ok") throw new Error("atteso ok");
    expect(today.provisional).toBe(true);
    expect(today.periods.experiment).toMatchObject({ from: dateOf(14), to: dateOf(20), days: 7, completeDays: 7 });
    expect(today.periods.reference).toMatchObject({ from: dateOf(7), to: dateOf(13) });
    const tomorrow = compareExperiment(experiment, { diary, intakeDays }, { asOf: dateOf(21), minObservations: 5 });
    if (tomorrow.status !== "ok") throw new Error("atteso ok");
    expect(tomorrow.provisional).toBe(false);
  });
});
