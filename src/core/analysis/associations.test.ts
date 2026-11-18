import { describe, expect, it } from "vitest";
import { findAssociations, type AssociationOptions } from "./associations";
import { analyze, analyzeLight, dateOf, day, moodOn, noise, rng, shuffled, symptomOn } from "./test-helpers";

const CONSONANTS = "bcdfghlmnprstvz";
/** Nomi inventati che finiscono per consonante, per non essere fusi dalla normalizzazione dei nomi. */
const foodName = (i: number): string =>
  `qx${CONSONANTS[i % CONSONANTS.length]}${CONSONANTS[Math.floor(i / CONSONANTS.length) % CONSONANTS.length]}`;

const clamp = (v: number): number => Math.min(5, Math.max(1, Math.round(v)));

interface WorldOptions {
  days?: number;
  decoys?: number;
  seed?: number;
  /** Probabilità di un esito registrato in un giorno. */
  moodRate?: number;
  /** Effetto sull'umore del giorno dopo se il giorno aveva l'alimento "Zorballa". */
  plantedLag1?: number;
  /** Effetto sul sintomo di sonno dello stesso giorno se la cena è tardiva. */
  lateDinnerSleep?: number;
  skipMoodOn?: (i: number) => boolean;
}

function world(o: WorldOptions = {}) {
  const { days = 45, decoys = 0, seed = 1, moodRate = 1, plantedLag1 = 0, lateDinnerSleep = 0 } = o;
  const random = rng(seed);
  const events: unknown[] = [];
  const planted: boolean[] = [];
  const lateDinner: boolean[] = [];
  for (let i = 0; i < days; i++) {
    const items: { name: string; grams?: number }[] = [];
    const hasPlanted = random() < 0.5;
    planted.push(hasPlanted);
    if (hasPlanted) items.push({ name: "Zorballa" });
    for (let k = 0; k < decoys; k++) if (random() < 0.35) items.push({ name: foodName(k) });
    const late = random() < 0.4;
    lateDinner.push(late);
    events.push(...day(i, { lunchItems: items, times: { dinner: late ? "22:00" : "19:30" } }));
  }
  for (let i = 0; i < days; i++) {
    if (o.skipMoodOn?.(i)) continue;
    if (random() < moodRate) {
      const effect = i > 0 && planted[i - 1] ? plantedLag1 : 0;
      const base = plantedLag1 !== 0 ? 3 + effect + noise(random, 0.5) : 1 + random() * 4;
      events.push(moodOn(i, clamp(base)));
    }
    if (random() < 0.5) {
      const base = lateDinnerSleep !== 0 ? 2 + (lateDinner[i] ? lateDinnerSleep : 0) + noise(random, 0.5) : 1 + random() * 4;
      events.push(symptomOn(i, "sleep", clamp(base)));
    }
  }
  return events;
}

describe("findAssociations: associazione reale", () => {
  it("fa emergere un effetto netto sul giorno dopo, anche tra molti alimenti casuali", () => {
    const { diary, intakeDays } = analyze(world({ days: 56, decoys: 25, plantedLag1: 1.5, seed: 4 }));
    const r = findAssociations(diary, intakeDays);
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.tested).toBeGreaterThan(50);
    const top = r.associations[0];
    expect(top.exposure.id).toMatch(/^food:zorbal/);
    expect(top.outcome).toBe("mood");
    expect(top.lag).toBe(1);
    expect(top.direction).toBe("higher");
    expect(top.difference).toBeGreaterThan(1);
    expect(top.adjustedPValue).toBeLessThanOrEqual(0.05);
    expect(top.strength).toBe("large");
    expect(top.withExposure.days).toBeGreaterThanOrEqual(8);
    expect(top.withoutExposure.days).toBeGreaterThanOrEqual(8);
    expect(top.interval.low).toBeGreaterThan(0);
    expect(top.summary).toMatch(/Associazione osservata/);
    expect(top.summary).toMatch(/il giorno dopo/);
    expect(r.associations.length).toBeLessThanOrEqual(5);
    expect(r.basis.usedDays).toBe(56);
    expect(r.caveats.join(" ")).toMatch(/non dicono che una cosa ne spieghi un'altra/);
  });

  it("riconosce anche un orario: cena tardiva e sintomo dello stesso giorno", () => {
    const { diary, intakeDays } = analyze(world({ days: 56, lateDinnerSleep: 1.5, seed: 9 }));
    const r = findAssociations(diary, intakeDays);
    if (r.status !== "ok") throw new Error("atteso ok");
    const hit = r.associations.find((a) => a.exposure.kind === "lateDinner" && a.outcome === "symptomSleep");
    expect(hit).toBeDefined();
    expect(hit?.lag).toBe(0);
    expect(hit?.exposure.label).toBe("cena dopo le 21:00");
  });

  it("i giorni senza l'esito non contano come esito basso", () => {
    const skip = (i: number) => i % 7 === 3;
    const { diary, intakeDays } = analyze(world({ days: 56, plantedLag1: 1.5, seed: 4, skipMoodOn: skip }));
    const r = findAssociations(diary, intakeDays);
    if (r.status !== "ok") throw new Error("atteso ok");
    const a = r.associations.find((x) => x.outcome === "mood" && x.lag === 1);
    if (!a) throw new Error("atteso un risultato");
    // Giorni d con l'umore registrato il giorno d+1: 55 giorni possibili meno quelli saltati.
    const expected = Array.from({ length: 55 }, (_, i) => i + 1).filter((j) => !skip(j)).length;
    expect(a.withExposure.days + a.withoutExposure.days).toBe(expected);
  });

  it("non dipende dall'ordine degli eventi", () => {
    const events = world({ days: 56, decoys: 10, plantedLag1: 1.5, seed: 4 });
    const a = analyze(events);
    const b = analyze(shuffled(events, rng(31)));
    expect(findAssociations(b.diary, b.intakeDays)).toEqual(findAssociations(a.diary, a.intakeDays));
  });
});

describe("findAssociations: protezioni", () => {
  // Registri di puro rumore (nessuna associazione vera) con seme fisso, costruiti una volta e
  // condivisi dalle prove. Si conta quanti registri mostrano almeno un'associazione: con il tasso
  // dichiarato `alpha` il conteggio atteso è al più alpha * N.
  //
  // Misure fatte durante lo sviluppo, su 200 registri (45 giorni, 30 alimenti casuali):
  //   sola t con soglia 0,05 (metodo iniziale): 19 registri (9,5%);
  //   sola t con soglia 0,01: 6 (3%);
  //   t + permutazione con soglia 0,01: 2 (1%); con soglia 0,05: 9 (4,5%).
  // La causa non è la dipendenza tra confronti (Holm vale comunque) ma la t, troppo ottimista nelle
  // code con punteggi discreti da 1 a 5 e gruppi piccoli o sbilanciati.
  //
  // Qui N = 150 con soglia 0,05, dove il metodo corretto atteso è ~7,5 registri (sd 2,7) e la sola
  // t ne dà ~14: tolleranza 13 (limite superiore al 99% del binomiale), oltre quella il tasso
  // dichiarato non sarebbe rispettato.
  const NOISE_N = 150;
  const NOISE_TIMEOUT_MS = 180_000;
  let noiseWorlds: ReturnType<typeof analyzeLight>[] | undefined;
  const noiseWorldsOnce = () =>
    (noiseWorlds ??= Array.from({ length: NOISE_N }, (_, k) =>
      analyzeLight(world({ days: 40, decoys: 20, moodRate: 0.85, seed: 20_000 + k })),
    ));
  const registersWithAny = (options: AssociationOptions): number =>
    noiseWorldsOnce().filter(({ diary, intakeDays }) => {
      const r = findAssociations(diary, intakeDays, options);
      return r.status === "ok" && r.associations.length > 0;
    }).length;

  it(
    "da dati casuali il tasso di registri con un'associazione non supera quello dichiarato",
    () => {
      const alpha = 0.05;
      const declaredUpper = 13;
      const corrected = registersWithAny({ alpha });
      expect(corrected).toBeLessThanOrEqual(declaredUpper);
      // La sola t, sugli stessi registri, supera la tolleranza: la prova di permutazione serve.
      const tOnly = registersWithAny({ alpha, permutationCheck: false });
      expect(tOnly).toBeGreaterThan(corrected);
    },
    NOISE_TIMEOUT_MS,
  );

  it(
    "con la soglia predefinita (1%) quasi nessun registro casuale mostra qualcosa, e il risultato dichiara il controllo",
    () => {
      let any = 0;
      for (const { diary, intakeDays } of noiseWorldsOnce()) {
        const r = findAssociations(diary, intakeDays);
        if (r.status !== "ok") throw new Error("atteso ok");
        if (r.associations.length > 0) any++;
        expect(r.control).toMatchObject({
          nominalFalsePositiveRate: 0.01,
          method: "holm+permutation",
          resolutionLimited: false,
        });
        expect(r.control.comparisons).toBe(r.tested);
        expect(r.control.permutations).toBeGreaterThanOrEqual((2 * r.tested) / 0.01);
      }
      // Atteso 1,5 su 150; tolleranza al 99% del binomiale.
      expect(any).toBeLessThanOrEqual(5);
    },
    NOISE_TIMEOUT_MS,
  );

  it("dati insufficienti con pochi giorni completi: nessun elenco", () => {
    const { diary, intakeDays } = analyze(world({ days: 10, decoys: 5, plantedLag1: 2, seed: 4 }));
    const r = findAssociations(diary, intakeDays);
    expect(r.status).toBe("insufficient");
    if (r.status === "insufficient") {
      expect(r.reasons).toEqual(["few_complete_days"]);
      expect(r).not.toHaveProperty("associations");
      expect(r.basis.usedDays).toBe(10);
    }
    expect(findAssociations(analyze([]).diary, []).status).toBe("insufficient");
  });

  it("sotto il minimo di giorni con e senza l'esposizione non si fa il confronto", () => {
    // L'alimento compare in 4 giorni su 30.
    const events: unknown[] = [];
    for (let i = 0; i < 30; i++) {
      events.push(...day(i, { lunchItems: i % 8 === 0 ? [{ name: "Zorballa" }] : [] }));
      events.push(moodOn(i, i % 8 === 0 ? 5 : 2));
    }
    const { diary, intakeDays } = analyze(events);
    const r = findAssociations(diary, intakeDays);
    expect(r.status === "insufficient" && r.reasons).toEqual(["no_testable_comparisons"]);
    // Abbassando i minimi lo stesso confronto diventa possibile.
    const loose = findAssociations(diary, intakeDays, { minDaysWith: 4 });
    expect(loose.status).toBe("ok");
  });

  it("i giorni con vuoti non entrano: un alimento presente solo in giorni incompleti non si confronta", () => {
    const events: unknown[] = [];
    for (let i = 0; i < 40; i++) {
      const incomplete = i % 3 === 0;
      events.push(...day(i, { skip: incomplete ? ["dinner"] : [], lunchItems: incomplete ? [{ name: "Zorballa" }] : [] }));
      events.push(moodOn(i, incomplete ? 5 : 2));
    }
    const { diary, intakeDays } = analyze(events);
    const r = findAssociations(diary, intakeDays);
    expect(r.status === "insufficient" && r.reasons).toEqual(["no_testable_comparisons"]);
    if (r.status === "insufficient") {
      expect(r.basis.excludedDays).toBe(14);
      expect(r.basis.usedDays).toBe(26);
    }
  });

  it("l'elenco è limitato e ordinato per forza", () => {
    const events: unknown[] = [];
    for (let i = 0; i < 60; i++) {
      const items = [{ name: "Zorballa" }, ...(i % 2 === 0 ? [{ name: "Qxmaro" }] : [])];
      events.push(...day(i, { lunchItems: i % 2 === 0 ? items : [{ name: "Zorballa", grams: 1 }].slice(1) }));
      events.push(moodOn(i, i % 2 === 0 ? 5 : 1));
    }
    const { diary, intakeDays } = analyze(events);
    const r = findAssociations(diary, intakeDays, { maxResults: 1 });
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.associations).toHaveLength(1);
    expect(r.passed).toBeGreaterThan(1);
    const all = findAssociations(diary, intakeDays, { maxResults: 50 });
    if (all.status !== "ok") throw new Error("atteso ok");
    const strengths = all.associations.map((a) => Math.abs(a.standardizedDifference));
    expect([...strengths].sort((a, b) => b - a)).toEqual(strengths);
  });

  it("i testi non parlano di cause, diagnosi o carenze", () => {
    const { diary, intakeDays } = analyze(world({ days: 56, decoys: 5, plantedLag1: 1.5, seed: 4 }));
    const r = findAssociations(diary, intakeDays);
    if (r.status !== "ok") throw new Error("atteso ok");
    const text = [...r.caveats, ...r.associations.map((a) => a.summary)].join(" ");
    expect(text).not.toMatch(/caus|diagnos|carenz|deficien|malatt/i);
    expect(dateOf(0)).toBe("2026-03-02");
  });
});

describe("findAssociations: pasti fuori casa stimati", () => {
  /** 40 giorni completi con umore; nei giorni indicati il pranzo è una stima fuori casa. */
  function log(outOn: (i: number) => boolean, total = 40) {
    const random = rng(3);
    const events: unknown[] = [];
    for (let i = 0; i < total; i++) {
      const out = outOn(i);
      events.push(...day(i, out ? { outOfHome: { kind: "lunch" as const, kcal: 800 } } : { lunchItems: random() < 0.5 ? [{ name: "Zorballa" }] : [] }));
      // l'umore è più basso proprio nei giorni fuori casa: se la stima valesse come alimento, verrebbe a galla
      events.push(moodOn(i, out ? 1 : 4 + (i % 2)));
    }
    return analyzeLight(events);
  }

  it("i giorni con una stima non entrano nel confronto, e l'avvertenza dice quanti sono", () => {
    const { diary, intakeDays } = log((i) => i % 4 === 0);
    const r = findAssociations(diary, intakeDays);
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.basis).toMatchObject({ usedDays: 30, outOfHomeDays: 10 });
    expect(r.caveats).toContain(
      "10 giorni tracciati per intero hanno un pasto fuori casa stimato e non entrano nel confronto: di quel pasto non si conoscono gli alimenti.",
    );
    expect(r.associations.map((a) => a.exposure.label).join(" ")).not.toMatch(/fuori casa/i);
  });

  it("se per questo i giorni non bastano, lo dice", () => {
    const { diary, intakeDays } = log((i) => i % 2 === 0, 20);
    const r = findAssociations(diary, intakeDays);
    expect(r.status).toBe("insufficient");
    if (r.status !== "insufficient") return;
    expect(r.reasons).toContain("few_complete_days");
    expect(r.basis).toMatchObject({ usedDays: 10, outOfHomeDays: 10 });
    expect(r.message).toMatch(/10 giorni tracciati per intero hanno un pasto fuori casa stimato/);
  });

  it("senza pasti fuori casa il conto non compare", () => {
    const { diary, intakeDays } = log(() => false);
    const r = findAssociations(diary, intakeDays);
    expect(r.basis.outOfHomeDays).toBeUndefined();
  });
});
