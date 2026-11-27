import { describe, expect, it } from "vitest";
import { findAssociations } from "./associations";
import { analyzeLight, dateOf, day, moodOn, noise, rng } from "./test-helpers";

const clamp = (v: number): number => Math.min(5, Math.max(1, Math.round(v)));

interface World {
  days?: number;
  seed?: number;
  /** Effetto sull'umore dello stesso giorno se la quota di prodotti molto lavorati è alta. */
  effect?: number;
  /** Giorni con copertura bassa: indici per cui la copertura è 0,3. */
  lowCoverage?: (i: number) => boolean;
}

function world({ days = 56, seed = 3, effect = -1.5, lowCoverage = () => false }: World = {}) {
  const random = rng(seed);
  const events: unknown[] = [];
  const shares: Record<string, { share: number; coverage: number }> = {};
  const high: boolean[] = [];
  for (let i = 0; i < days; i++) {
    events.push(...day(i));
    // metà dei giorni sopra 0,4 e metà sotto: la mediana cade tra i due gruppi
    const isHigh = i % 2 === 0;
    high.push(isHigh);
    shares[dateOf(i)] = { share: isHigh ? 0.45 + random() * 0.2 : 0.1 + random() * 0.2, coverage: lowCoverage(i) ? 0.3 : 0.9 };
    events.push(moodOn(i, clamp(3.5 + (isHigh ? effect : 0) + noise(random, 0.4))));
  }
  return { events, shares, high };
}

describe("findAssociations: giorni con più prodotti molto lavorati del solito", () => {
  it("fa emergere un effetto netto dello stesso giorno", () => {
    const { events, shares } = world();
    const { diary, intakeDays } = analyzeLight(events);
    const r = findAssociations(diary, intakeDays, { processedShareByDate: shares });
    if (r.status !== "ok") throw new Error("atteso ok");
    const found = r.associations.find((a) => a.exposure.id === "processed:high");
    expect(found).toBeDefined();
    expect(found?.exposure.kind).toBe("processedHigh");
    expect(found?.exposure.label).toBe("più energia del solito da prodotti molto lavorati");
    expect(found?.outcome).toBe("mood");
    expect(found?.lag).toBe(0);
    expect(found?.direction).toBe("lower");
    expect(found?.withExposure.days).toBe(28);
    expect(found?.withoutExposure.days).toBe(28);
    expect(found?.summary).toMatch(/Associazione osservata/);
    expect(r.caveats.join(" ")).toMatch(/non dicono che una cosa ne spieghi un'altra/);
  });

  it("senza le quote per data l'esposizione non esiste", () => {
    const { events } = world();
    const { diary, intakeDays } = analyzeLight(events);
    const r = findAssociations(diary, intakeDays);
    expect(r.status === "ok" ? r.associations.some((a) => a.exposure.kind === "processedHigh") : false).toBe(false);
  });

  it("i giorni con copertura bassa non contano né tra i «con» né tra i «senza»", () => {
    // i giorni 0..13 hanno copertura bassa: restano 42 giorni, 21 per parte
    const { events, shares } = world({ lowCoverage: (i) => i < 14 });
    const { diary, intakeDays } = analyzeLight(events);
    const r = findAssociations(diary, intakeDays, { processedShareByDate: shares });
    if (r.status !== "ok") throw new Error("atteso ok");
    const found = r.associations.find((a) => a.exposure.id === "processed:high");
    expect(found?.withExposure.days).toBe(21);
    expect(found?.withoutExposure.days).toBe(21);
  });

  it("la copertura minima si può cambiare", () => {
    const { events, shares } = world({ lowCoverage: (i) => i < 14 });
    const { diary, intakeDays } = analyzeLight(events);
    const r = findAssociations(diary, intakeDays, { processedShareByDate: shares, processedMinCoverage: 0.2 });
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.associations.find((a) => a.exposure.id === "processed:high")?.withExposure.days).toBe(28);
  });

  it("senza un effetto non compare nulla, e un giorno sulla mediana non è «alto»", () => {
    const { events, shares } = world({ effect: 0, seed: 9 });
    // tutti i giorni alla stessa quota: nessuno è sopra la mediana, l'esposizione non ha giorni «con»
    const flat = Object.fromEntries(Object.keys(shares).map((d) => [d, { share: 0.3, coverage: 0.9 }]));
    const { diary, intakeDays } = analyzeLight(events);
    for (const input of [shares, flat]) {
      const r = findAssociations(diary, intakeDays, { processedShareByDate: input });
      expect(r.status === "ok" ? r.associations.some((a) => a.exposure.id === "processed:high") : false).toBe(false);
    }
  });

  it("con meno di due giorni coperti l'esposizione non si definisce", () => {
    const { events } = world();
    const { diary, intakeDays } = analyzeLight(events);
    const r = findAssociations(diary, intakeDays, { processedShareByDate: { [dateOf(0)]: { share: 0.9, coverage: 0.9 } } });
    expect(r.status === "ok" ? r.associations.some((a) => a.exposure.kind === "processedHigh") : false).toBe(false);
  });
});
