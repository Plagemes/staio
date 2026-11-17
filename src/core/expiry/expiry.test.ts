import { describe, expect, it } from "vitest";
import {
  SHELF_LIFE,
  addDays,
  addMonths,
  dailyDigest,
  diffDays,
  eatFirstOrder,
  effectiveExpiry,
  toCalendarDate,
  urgency,
  type ExpiryItem,
} from "./index";

const NOW = "2026-11-17";

function item(over: Partial<ExpiryItem> = {}): ExpiryItem {
  return {
    id: "x",
    labelDateType: "none",
    purchaseDate: "2026-11-10",
    location: "frigo",
    category: "yogurt",
    ...over,
  };
}

describe("date", () => {
  it("passaggio di mese e di anno", () => {
    expect(addDays("2026-01-30", 3)).toBe("2026-02-02");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-01-02", -3)).toBe("2025-12-30");
  });
  it("anno bisestile", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(diffDays("2025-03-01", "2024-03-01")).toBe(365);
    expect(diffDays("2024-03-01", "2023-03-01")).toBe(366);
  });
  it("mesi con giorno inesistente si fermano a fine mese", () => {
    expect(addMonths("2025-08-31", 6)).toBe("2026-02-28");
    expect(addMonths("2023-08-31", 6)).toBe("2024-02-29");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });
  it("rifiuta date non valide", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow();
    expect(() => addDays("26-02-01", 1)).toThrow();
  });
  it("nessun errore di fuso con il cambio dell'ora legale", () => {
    expect(diffDays("2026-03-30", "2026-03-28")).toBe(2);
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
  });
});

describe("tabella durate", () => {
  it("copre circa 35 categorie con valori sensati", () => {
    const keys = Object.keys(SHELF_LIFE);
    expect(keys.length).toBe(35);
    for (const v of Object.values(SHELF_LIFE)) {
      expect(v.fridgeDays).toBeGreaterThanOrEqual(0);
      expect(v.pantryDays).toBeGreaterThanOrEqual(0);
      expect(v.afterOpeningDays).toBeGreaterThan(0);
      expect(v.freezerMonths).toBeGreaterThan(0);
      expect(v.afterThawDays).toBeGreaterThan(0);
    }
  });
});

describe("effectiveExpiry", () => {
  it("usa la data in etichetta use_by come sicurezza", () => {
    const r = effectiveExpiry(item({ labelDateType: "use_by", labelDate: "2026-11-20" }), NOW);
    expect(r).toEqual({ date: "2026-11-20", basis: "label", nature: "safety", certainty: "label" });
  });
  it("best_before è qualità", () => {
    const r = effectiveExpiry(item({ labelDateType: "best_before", labelDate: "2026-12-01" }), NOW);
    expect(r.nature).toBe("quality");
    expect(r.basis).toBe("label");
  });
  it("etichetta di tipo estimated ha certezza estimated", () => {
    const r = effectiveExpiry(item({ labelDateType: "estimated", labelDate: "2026-12-01" }), NOW);
    expect(r.basis).toBe("label");
    expect(r.certainty).toBe("estimated");
  });
  it("tipo none ignora una data eventualmente presente", () => {
    const r = effectiveExpiry(item({ labelDateType: "none", labelDate: "2026-12-01" }), NOW);
    expect(r.basis).toBe("estimated");
  });
  it("senza etichetta: acquisto + durata per categoria e luogo", () => {
    const fridge = effectiveExpiry(item({ category: "poultry", purchaseDate: "2026-11-10" }), NOW);
    expect(fridge).toMatchObject({ date: "2026-11-12", basis: "estimated", nature: "safety", certainty: "estimated" });
    const pantry = effectiveExpiry(
      item({ category: "bread_fresh", location: "dispensa", purchaseDate: "2026-12-30" }),
      NOW,
    );
    expect(pantry).toMatchObject({ date: "2027-01-02", nature: "quality" });
  });
  it("apertura prima della data in etichetta: vince l'apertura", () => {
    const r = effectiveExpiry(
      item({ labelDateType: "use_by", labelDate: "2026-12-20", openedDate: "2026-11-15", category: "milk_fresh" }),
      NOW,
    );
    expect(r).toMatchObject({ date: "2026-11-18", basis: "opened", nature: "safety", certainty: "estimated" });
  });
  it("aperto con best_before precedente: il limite di sicurezza dopo l'apertura resta", () => {
    const r = effectiveExpiry(
      item({ labelDateType: "best_before", labelDate: "2026-11-16", openedDate: "2026-11-15", category: "milk_fresh" }),
      NOW,
    );
    expect(r).toMatchObject({ date: "2026-11-18", basis: "opened", nature: "safety", qualityDate: "2026-11-16" });
  });
  it("latte UHT best_before 1 dicembre aperto il 30 novembre: scaduto (sicurezza) il 10 dicembre", () => {
    const it = item({
      category: "milk_uht",
      location: "dispensa",
      purchaseDate: "2026-11-01",
      labelDateType: "best_before",
      labelDate: "2026-12-01",
      openedDate: "2026-11-30",
    });
    const e = effectiveExpiry(it, "2026-12-10");
    expect(e).toMatchObject({ date: "2026-12-03", basis: "opened", nature: "safety", qualityDate: "2026-12-01" });
    expect(urgency(e, "2026-12-10").level).toBe("expired");
  });
  it("aperto con use_by precedente al limite: vince l'etichetta", () => {
    const r = effectiveExpiry(
      item({ labelDateType: "use_by", labelDate: "2026-11-16", openedDate: "2026-11-15", category: "milk_fresh" }),
      NOW,
    );
    expect(r).toMatchObject({ date: "2026-11-16", basis: "label", nature: "safety" });
  });
  it("a parità vince l'etichetta", () => {
    const r = effectiveExpiry(
      item({ labelDateType: "use_by", labelDate: "2026-11-18", openedDate: "2026-11-15", category: "milk_fresh" }),
      NOW,
    );
    expect(r.basis).toBe("label");
  });
  it("aperto senza etichetta: la più vicina tra stima e apertura", () => {
    const r = effectiveExpiry(
      item({ category: "juices_opened", purchaseDate: "2026-11-10", openedDate: "2026-11-15" }),
      NOW,
    );
    // stima 2026-11-15, apertura 2026-11-20
    expect(r).toMatchObject({ date: "2026-11-15", basis: "estimated" });
    const r2 = effectiveExpiry(
      item({ category: "yogurt", purchaseDate: "2026-11-10", openedDate: "2026-11-12" }),
      NOW,
    );
    // stima 2026-11-24, apertura 2026-11-16
    expect(r2).toMatchObject({ date: "2026-11-16", basis: "opened" });
  });
  it("apertura a cavallo d'anno", () => {
    const r = effectiveExpiry(item({ category: "butter", purchaseDate: "2026-12-14", openedDate: "2026-12-15" }), "2026-12-20");
    expect(r.date).toBe("2027-01-13");
  });
  it("freezer: congelamento + mesi, ignora l'etichetta", () => {
    const r = effectiveExpiry(
      item({
        location: "freezer",
        category: "red_meat_fresh",
        frozenDate: "2026-11-30",
        labelDateType: "use_by",
        labelDate: "2026-12-01",
      }),
      NOW,
    );
    expect(r).toMatchObject({ date: "2027-05-30", basis: "frozen", nature: "quality", certainty: "estimated" });
  });
  it("freezer senza data di congelamento usa l'acquisto", () => {
    const r = effectiveExpiry(item({ location: "freezer", category: "frozen_foods", purchaseDate: "2025-08-31" }), NOW);
    expect(r.date).toBe("2026-02-28");
  });
  it("scongelamento: scongelamento + giorni dopo scongelamento", () => {
    const r = effectiveExpiry(
      item({
        location: "frigo",
        category: "fish_fresh",
        frozenDate: "2026-10-01",
        thawedDate: "2026-11-16",
      }),
      NOW,
    );
    expect(r).toMatchObject({ date: "2026-11-17", basis: "thawed", nature: "safety" });
  });
  it("scongelamento a cavallo d'anno e bisestile", () => {
    const r = effectiveExpiry(
      item({ category: "red_meat_fresh", thawedDate: "2027-12-31" }),
      "2027-12-31",
    );
    expect(r.date).toBe("2028-01-02");
    const b = effectiveExpiry(item({ category: "red_meat_fresh", thawedDate: "2028-02-28" }), "2028-02-28");
    expect(b.date).toBe("2028-03-01");
  });
});

describe("urgency", () => {
  const safety = (date: string) => ({ date, nature: "safety" as const });
  it("livelli", () => {
    expect(urgency(safety("2026-11-16"), NOW)).toEqual({ level: "expired", daysLeft: -1 });
    expect(urgency(safety("2026-11-17"), NOW)).toEqual({ level: "today", daysLeft: 0 });
    expect(urgency(safety("2026-11-18"), NOW)).toEqual({ level: "tomorrow", daysLeft: 1 });
    expect(urgency(safety("2026-11-19"), NOW)).toEqual({ level: "soon", daysLeft: 2 });
    expect(urgency(safety("2026-11-20"), NOW)).toEqual({ level: "soon", daysLeft: 3 });
    expect(urgency(safety("2026-11-21"), NOW)).toEqual({ level: "ok", daysLeft: 4 });
  });
  it("qualità superata", () => {
    expect(urgency({ date: "2026-11-10", nature: "quality" }, NOW)).toEqual({ level: "past_quality", daysLeft: -7 });
    expect(urgency({ date: "2026-11-17", nature: "quality" }, NOW).level).toBe("today");
  });
  it("passaggio di anno e bisestile", () => {
    expect(urgency(safety("2027-01-01"), "2026-12-31").level).toBe("tomorrow");
    expect(urgency(safety("2024-03-01"), "2024-02-28").daysLeft).toBe(2);
  });
  it("accetta un istante ISO UTC", () => {
    // 23:59 UTC sono già le 00:59 del 18 a Roma
    expect(urgency(safety("2026-11-18"), "2026-11-17T23:59:59.000Z").level).toBe("today");
    expect(urgency(safety("2026-11-18"), "2026-11-17T23:59:59.000Z", "UTC").level).toBe("tomorrow");
  });
});

describe("eatFirstOrder", () => {
  it("per priorità: la qualità vale almeno 3 giorni", () => {
    const items = [
      item({ id: "q-today", labelDateType: "best_before", labelDate: "2026-11-17" }), // 3
      item({ id: "s-late", labelDateType: "use_by", labelDate: "2026-11-25" }), // 8
      item({ id: "s-soon", labelDateType: "use_by", labelDate: "2026-11-18" }), // 1
      item({ id: "q-late", labelDateType: "best_before", labelDate: "2026-12-30" }), // 36
    ];
    expect(eatFirstOrder(items, NOW).ordered.map((e) => e.item.id)).toEqual(["s-soon", "q-today", "s-late", "q-late"]);
  });
  it("sicurezza a 20 giorni dopo qualità scaduta ieri", () => {
    const items = [
      item({ id: "s20", labelDateType: "use_by", labelDate: "2026-12-07" }),
      item({ id: "q-yesterday", labelDateType: "best_before", labelDate: "2026-11-16" }),
    ];
    expect(eatFirstOrder(items, NOW).ordered.map((e) => e.item.id)).toEqual(["q-yesterday", "s20"]);
  });
  it("qualità scaduta da 10 giorni dopo pollo che scade domani", () => {
    const items = [
      item({ id: "q-old", labelDateType: "best_before", labelDate: "2026-11-07" }),
      item({ id: "pollo", category: "poultry", labelDateType: "use_by", labelDate: "2026-11-18" }),
    ];
    expect(eatFirstOrder(items, NOW).ordered.map((e) => e.item.id)).toEqual(["pollo", "q-old"]);
  });
  it("a parità di priorità prima la sicurezza", () => {
    const items = [
      item({ id: "q", labelDateType: "best_before", labelDate: "2026-11-17" }), // 3
      item({ id: "s", labelDateType: "use_by", labelDate: "2026-11-20" }), // 3
    ];
    expect(eatFirstOrder(items, NOW).ordered.map((e) => e.item.id)).toEqual(["s", "q"]);
  });
  it("a parità di giorni prima ciò che è aperto, poi l'ordine di ingresso", () => {
    const items = [
      item({ id: "a", labelDateType: "use_by", labelDate: "2026-11-20" }),
      item({ id: "b", labelDateType: "use_by", labelDate: "2026-11-20", openedDate: "2026-11-16", category: "butter" }),
      item({ id: "c", labelDateType: "use_by", labelDate: "2026-11-20" }),
    ];
    expect(eatFirstOrder(items, NOW).ordered.map((e) => e.item.id)).toEqual(["b", "a", "c"]);
  });
  it("le scadute di sicurezza vengono per prime", () => {
    const items = [
      item({ id: "ok", labelDateType: "use_by", labelDate: "2026-11-19" }),
      item({ id: "old", labelDateType: "use_by", labelDate: "2026-11-01" }),
    ];
    expect(eatFirstOrder(items, NOW).ordered[0].item.id).toBe("old");
  });
  it("non modifica l'array di ingresso", () => {
    const items = [
      item({ id: "a", labelDateType: "use_by", labelDate: "2026-11-25" }),
      item({ id: "b", labelDateType: "use_by", labelDate: "2026-11-18" }),
    ];
    eatFirstOrder(items, NOW);
    expect(items.map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("dailyDigest", () => {
  it("raggruppa per urgenza e ignora ciò che è ok", () => {
    const items = [
      item({ id: "exp", labelDateType: "use_by", labelDate: "2026-11-15" }),
      item({ id: "pq", labelDateType: "best_before", labelDate: "2026-11-10" }),
      item({ id: "today", labelDateType: "use_by", labelDate: "2026-11-17" }),
      item({ id: "tom", labelDateType: "use_by", labelDate: "2026-11-18" }),
      item({ id: "soon", labelDateType: "use_by", labelDate: "2026-11-20" }),
      item({ id: "ok", labelDateType: "use_by", labelDate: "2026-12-20" }),
    ];
    const d = dailyDigest(items, NOW);
    expect(d.expired.map((e) => e.item.id)).toEqual(["exp"]);
    expect(d.pastQuality.map((e) => e.item.id)).toEqual(["pq"]);
    expect(d.today.map((e) => e.item.id)).toEqual(["today"]);
    expect(d.tomorrow.map((e) => e.item.id)).toEqual(["tom"]);
    expect(d.soon.map((e) => e.item.id)).toEqual(["soon"]);
    expect(d.total).toBe(5);
  });
  it("vuoto se non c'è nulla da segnalare", () => {
    const d = dailyDigest([item({ labelDateType: "use_by", labelDate: "2027-01-01" })], NOW);
    expect(d.total).toBe(0);
    expect(dailyDigest([], NOW).total).toBe(0);
  });
  it("dentro un gruppo l'ordine è quello di 'mangia prima'", () => {
    const items = [
      item({ id: "b", labelDateType: "use_by", labelDate: "2026-11-20" }),
      item({ id: "a", labelDateType: "use_by", labelDate: "2026-11-19" }),
    ];
    expect(dailyDigest(items, NOW).soon.map((e) => e.item.id)).toEqual(["a", "b"]);
  });
});

describe("correzioni dopo revisione", () => {
  it("deperibile in dispensa resta di sicurezza, anche con 0 giorni", () => {
    const e = effectiveExpiry(
      item({ category: "poultry", location: "dispensa", purchaseDate: "2026-11-10" }),
      NOW,
    );
    expect(e).toMatchObject({ date: "2026-11-10", nature: "safety" });
    expect(urgency(e, NOW).level).toBe("expired");
    const e2 = effectiveExpiry(item({ category: "eggs", location: "dispensa", purchaseDate: "2026-11-10" }), NOW);
    expect(e2.nature).toBe("safety");
  });
  it("non deperibile in dispensa resta di qualità", () => {
    expect(effectiveExpiry(item({ category: "bread_fresh", location: "dispensa" }), NOW).nature).toBe("quality");
  });

  it("giorno locale a Roma: mezzanotte e mezza d'estate", () => {
    const e = { date: "2026-07-14", nature: "safety" as const };
    expect(urgency(e, "2026-07-14T22:30:00.000Z").level).toBe("expired");
    expect(urgency(e, "2026-07-14T21:59:59.000Z").level).toBe("today");
    expect(urgency(e, "2026-07-14T22:30:00.000Z", "UTC").level).toBe("today");
  });
  it("giorno locale a Roma: mezzanotte e mezza d'inverno", () => {
    const e = { date: "2026-12-14", nature: "safety" as const };
    expect(urgency(e, "2026-12-14T23:30:00.000Z").level).toBe("expired");
    expect(urgency(e, "2026-12-14T22:59:59.000Z").level).toBe("today");
    expect(urgency(e, new Date("2026-12-14T23:30:00.000Z")).level).toBe("expired");
  });
  it("una data 'YYYY-MM-DD' resta com'è", () => {
    expect(toCalendarDate("2026-07-14", "Asia/Tokyo")).toBe("2026-07-14");
  });

  it("voce con data non valida: scartata senza eccezioni", () => {
    const items = [
      item({ id: "bad", labelDateType: "use_by", labelDate: "2026-02-31" }),
      item({ id: "bad2", purchaseDate: "boh" }),
      item({ id: "good", labelDateType: "use_by", labelDate: "2026-11-18" }),
    ];
    const o = eatFirstOrder(items, NOW);
    expect(o.ordered.map((e) => e.item.id)).toEqual(["good"]);
    expect(o.rejected.map((r) => r.item.id)).toEqual(["bad", "bad2"]);
    const d = dailyDigest(items, NOW);
    expect(d.tomorrow.map((e) => e.item.id)).toEqual(["good"]);
    expect(d.rejected.length).toBe(2);
    expect(d.total).toBe(1);
  });
  it("un `now` non valido lancia", () => {
    expect(() => eatFirstOrder([], "non-una-data")).toThrow();
  });

  it("scongelato e ricongelato: in freezer vale l'ultimo congelamento", () => {
    const e = effectiveExpiry(
      item({
        category: "red_meat_fresh",
        location: "freezer",
        frozenDate: "2026-11-10",
        thawedDate: "2026-11-01",
      }),
      NOW,
    );
    expect(e).toMatchObject({ date: "2027-05-10", basis: "frozen" });
  });

  it("valori prudenti della tabella", () => {
    expect(SHELF_LIFE.eggs.fridgeDays).toBe(14);
    expect(SHELF_LIFE.cold_cuts_sliced.fridgeDays).toBe(3);
    expect(SHELF_LIFE.milk_fresh.fridgeDays).toBe(3);
    expect(SHELF_LIFE.pastries_fresh).toMatchObject({ pantryDays: 0, fridgeDays: 2 });
    expect(SHELF_LIFE.leftovers_cooked.afterThawDays).toBe(1);
    expect(SHELF_LIFE.condiments_sauces.afterOpeningDays).toBe(30);
    expect(SHELF_LIFE.sauces_preserves_opened).toMatchObject({ fridgeDays: 5, afterOpeningDays: 5 });
  });
});
