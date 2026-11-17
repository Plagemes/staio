import { describe, expect, it } from "vitest";
import {
  DEFAULT_THRESHOLDS,
  addDaysTo,
  diffScan,
  formatAmount,
  formatDay,
  orderDifferences,
  parsePantryScan,
  recordZone,
  suggestSecondPhoto,
  zoneMapFrom,
  type Difference,
  type DiffContext,
  type ExpectedLot,
  type PantryScan,
  type ScanLotReading,
} from "./index";
import { FRIDGE, FRIDGE_RESPONSE, json } from "./pantryFixtures";

const ctx: DiffContext = { location: "frigo", today: "2026-11-17" };
const scanOf = (text: string) => parsePantryScan(text, FRIDGE, { location: "frigo" });
const diffOf = (lots: unknown[], unexpected: unknown[] = [], expected: ExpectedLot[] = FRIDGE, context = ctx) =>
  diffScan(parsePantryScan(json({ lots, unexpected }), expected, { location: "frigo" }), expected, context);
const byKey = (diffs: Difference[], key: string) => diffs.find((d) => d.key === key);

describe("diffScan sulla risposta completa", () => {
  const diffs = diffScan(scanOf(json(FRIDGE_RESPONSE)), FRIDGE, ctx);

  it("produce quantità, scadenza, finito, da consumare presto e inatteso, e niente per i non visti", () => {
    expect(diffs.map((d) => d.key).sort()).toEqual(["L1:expiry", "L1:quantity", "L3:finished", "L4:soon", "new:0", "new:1"]);
    expect(diffs.some((d) => d.lotId === "L5" || d.lotId === "L6")).toBe(false);
  });

  it("ogni differenza ha certezza e ragione", () => {
    for (const d of diffs) {
      expect(d.confidence).toBeGreaterThan(0);
      expect(d.confidence).toBeLessThanOrEqual(1);
      expect(d.reason.length).toBeGreaterThan(10);
      expect(d.confirmLabel).not.toBe("");
    }
  });

  it("quantità cambiata: proposta di riallineamento", () => {
    expect(byKey(diffs, "L1:quantity")).toMatchObject({
      kind: "quantity_changed",
      mode: "proposal",
      confidence: 0.8,
      change: { type: "adjust", remaining: { value: 500, unit: "ml" } },
    });
    expect(byKey(diffs, "L1:quantity")?.reason).toContain("1 l");
  });

  it("assente con buona certezza: probabilmente finito", () => {
    expect(byKey(diffs, "L3:finished")).toMatchObject({ kind: "probably_finished", mode: "proposal", change: { type: "adjust", remaining: { value: 0, unit: "ml" } } });
  });

  it("scadenza letta diversa da quella registrata", () => {
    const d = byKey(diffs, "L1:expiry");
    expect(d).toMatchObject({ kind: "expiry_differs", change: { type: "expiry", expiry: { date: "2026-11-22", kind: "best_before" }, registered: "2026-11-20" } });
    expect(d?.reason).toContain("22 nov 2026");
  });

  it("fresco da consumare presto: scadenza stimata a due giorni", () => {
    expect(byKey(diffs, "L4:soon")).toMatchObject({ kind: "use_soon", change: { type: "expiry", expiry: { date: "2026-11-19", kind: "estimated" } } });
  });

  it("elemento inatteso: proposta di aggiunta; se somiglia a un lotto atteso diventa una domanda", () => {
    expect(byKey(diffs, "new:0")).toMatchObject({ kind: "unexpected_item", mode: "proposal", name: "Marmellata di fragole", change: { type: "declare", quantity: { value: 1, unit: "pz" }, quantityGuessed: false } });
    expect(byKey(diffs, "new:1")).toMatchObject({ mode: "question", name: "Yogurt", change: { quantityGuessed: true } });
    expect(byKey(diffs, "new:1")?.confidence).toBeLessThan(DEFAULT_THRESHOLDS.propose);
  });
});

describe("«non visto» non diventa mai «assente»", () => {
  it("nessun lotto non visto produce differenze, qualunque sia la certezza o il loro numero", () => {
    const all = FRIDGE.map((l) => ({ id: l.id, status: "not_seen", confidence: 1 }));
    expect(diffOf(all)).toEqual([]);
    expect(diffOf([])).toEqual([]);
    expect(diffScan(scanOf("niente"), FRIDGE, ctx)).toEqual([]);
  });

  it("nemmeno se è l'unico lotto, o se tutti i lotti sono non visti con la foto in uno stato pessimo", () => {
    const one = [FRIDGE[1]];
    expect(diffOf([{ id: "L2", status: "not_seen", confidence: 0.99 }], [], one)).toEqual([]);
  });

  it("un «assente» con poca certezza si ferma a «non visto» già nell'interprete, quindi senza differenze", () => {
    expect(diffOf([{ id: "L3", status: "absent", confidence: 0.6 }])).toEqual([]);
  });

  it("il livello o la scadenza di un lotto non visto non producono differenze", () => {
    const lots = [{ id: "L1", status: "not_seen", confidence: 0.9, level: { fraction: 0, confidence: 1 }, expiry: { date: "2030-01-01", confidence: 1 } }];
    expect(diffOf(lots)).toEqual([]);
  });

  it("un'estrazione costruita a mano con un lotto non visto non lo trasforma in assente", () => {
    const lot: ScanLotReading = { id: "L1", status: "not_seen", confidence: 1 };
    const scan: PantryScan = { lots: [lot], unexpected: [], unreadable: [], problems: [] };
    expect(diffScan(scan, FRIDGE, ctx)).toEqual([]);
  });
});

describe("soglie di incertezza", () => {
  const absent = (confidence: number) => diffOf([{ id: "L3", status: "absent", confidence: Math.max(confidence, 0.7) }]);
  const seenLevel = (confidence: number, fraction = 0.5) => diffOf([{ id: "L1", status: "seen", confidence: 0.9, level: { fraction, confidence } }]);

  it("da 0,75 in su è una proposta, sotto è una domanda", () => {
    expect(seenLevel(0.75)[0].mode).toBe("proposal");
    expect(seenLevel(0.74)[0].mode).toBe("question");
    expect(seenLevel(0.74)[0].question).toBe("Di Latte intero ne resta circa 500 ml?");
  });

  it("sotto 0,3 non si propone niente", () => {
    expect(seenLevel(0.3)).toHaveLength(1);
    expect(seenLevel(0.29)).toEqual([]);
  });

  it("la domanda sul finito ha le parole giuste", () => {
    const [d] = absent(0.72);
    expect(d).toMatchObject({ kind: "probably_finished", mode: "question", question: "C'è ancora Passata di pomodoro?", confirmLabel: "No, è finito", declineLabel: "Sì, c'è ancora" });
  });

  it("le soglie si possono cambiare", () => {
    const strict = diffOf([{ id: "L1", status: "seen", confidence: 0.9, level: { fraction: 0.5, confidence: 0.8 } }], [], FRIDGE, { ...ctx, thresholds: { propose: 0.9 } });
    expect(strict[0].mode).toBe("question");
    const lenient = diffOf([{ id: "L1", status: "seen", confidence: 0.9, level: { fraction: 0.5, confidence: 0.4 } }], [], FRIDGE, { ...ctx, thresholds: { propose: 0.3 } });
    expect(lenient[0].mode).toBe("proposal");
  });

  it("l'elemento inatteso segue le stesse soglie", () => {
    expect(diffOf([], [{ name: "Salsa", confidence: 0.8 }])[0].mode).toBe("proposal");
    expect(diffOf([], [{ name: "Salsa", confidence: 0.5 }])[0].mode).toBe("question");
    expect(diffOf([], [{ name: "Salsa", confidence: 0.2 }])).toEqual([]);
  });
});

describe("quantità", () => {
  const level = (id: string, fraction: number) => diffOf([{ id, status: "seen", confidence: 0.9, level: { fraction, confidence: 0.9 } }]);

  it("una variazione piccola non è una differenza", () => {
    expect(level("L1", 0.9)).toEqual([]); // 900 contro 1000: meno del 20% dell'iniziale
    expect(level("L1", 1)).toEqual([]);
  });

  it("propone a passi del 5% e mai oltre la quantità iniziale", () => {
    expect(level("L3", 0.37)[0].change).toEqual({ type: "adjust", remaining: { value: 245, unit: "ml" } }); // 0,35 x 700
    expect(level("L3", 1)[0].change).toEqual({ type: "adjust", remaining: { value: 700, unit: "ml" } }); // il registro dice 500: la foto dice pieno
  });

  it("i pezzi restano interi", () => {
    const [d] = level("L2", 0.4); // 4 pz x 0,4
    expect(d.change).toEqual({ type: "adjust", remaining: { value: 2, unit: "pz" } });
  });

  it("contenitore vuoto: probabilmente finito, non una quantità", () => {
    const [d] = level("L6", 0.04);
    expect(d).toMatchObject({ kind: "probably_finished", change: { remaining: { value: 0 } } });
  });
});

describe("scadenze", () => {
  it("una data uguale a quella registrata non è una differenza", () => {
    expect(diffOf([{ id: "L1", status: "seen", confidence: 0.9, expiry: { date: "2026-11-20", confidence: 0.9 } }])).toEqual([]);
  });

  it("senza scadenza registrata la ragione lo dice", () => {
    const [d] = diffOf([{ id: "L2", status: "seen", confidence: 0.9, expiry: { date: "2026-12-05", kind: "use_by", confidence: 0.9 } }]);
    expect(d.reason).toContain("non c'è una scadenza");
    expect(d.change).toEqual({ type: "expiry", expiry: { date: "2026-12-05", kind: "use_by" } });
  });

  it("il tipo di data si prende dalla registrata se il modello non lo dice", () => {
    const [d] = diffOf([{ id: "L1", status: "seen", confidence: 0.9, expiry: { date: "2026-11-25", confidence: 0.9 } }]);
    expect(d.change).toMatchObject({ expiry: { kind: "use_by" } });
  });

  it("al più una proposta di scadenza per lotto: la data più vicina", () => {
    const lots = [{ id: "L2", status: "seen", confidence: 0.9, expiry: { date: "2026-12-20", confidence: 0.9 }, freshness: { state: "use_soon", confidence: 0.9 } }];
    const diffs = diffOf(lots);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].kind).toBe("use_soon");
    const late = diffOf([{ id: "L2", status: "seen", confidence: 0.9, expiry: { date: "2026-11-18", confidence: 0.9 }, freshness: { state: "use_soon", confidence: 0.9 } }]);
    expect(late).toHaveLength(1);
    expect(late[0].kind).toBe("expiry_differs");
  });

  it("da consumare presto su un lotto con data d'etichetta: solo un avviso, la data non si tocca", () => {
    // L1 ha una data d'etichetta (use_by 20 nov): la stima visiva non la sostituisce
    const diffs = diffOf([{ id: "L1", status: "seen", confidence: 0.9, freshness: { state: "use_soon", confidence: 0.9 } }]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ kind: "use_soon", change: { type: "notice", labelDate: "2026-11-20", labelKind: "use_by" } });
    expect(diffs[0].reason).toContain("la data in etichetta è 20 nov 2026");
  });

  it("«da buttare» propone la data di oggi e dice che è un'impressione", () => {
    const [d] = diffOf([{ id: "L4", status: "seen", confidence: 0.9, freshness: { state: "discard", confidence: 0.9 } }]);
    expect(d.change).toEqual({ type: "expiry", expiry: { date: "2026-11-17", kind: "estimated" } });
    expect(d.reason).toMatch(/impressione/);
  });

  it("freschezza buona: niente", () => {
    expect(diffOf([{ id: "L4", status: "seen", confidence: 0.9, freshness: { state: "good", confidence: 0.9 } }])).toEqual([]);
  });
});

describe("ordine delle differenze", () => {
  const diffs = diffScan(
    parsePantryScan(
      json({
        lots: [
          { id: "L1", status: "seen", confidence: 0.9, level: { fraction: 0.5, confidence: 0.5 }, zone: "sportello" },
          { id: "L2", status: "seen", confidence: 0.9, level: { fraction: 0.5, confidence: 0.5 }, zone: "ripiano_alto" },
          { id: "L4", status: "seen", confidence: 0.9, level: { fraction: 0.2, confidence: 0.5 }, zone: "cassetto_verdure" },
          { id: "L3", status: "absent", confidence: 0.9 },
        ],
      }),
      FRIDGE,
      { location: "frigo" },
    ),
    FRIDGE,
    ctx,
  );

  it("prima le proposte, poi le domande per zona nell'ordine in cui si guarda il frigo", () => {
    const ordered = orderDifferences(diffs, "frigo", {});
    expect(ordered[0]).toMatchObject({ key: "L3:finished", mode: "proposal" });
    expect(ordered.slice(1).map((d) => d.zone)).toEqual(["ripiano_alto", "cassetto_verdure", "sportello"]);
  });

  it("la mappa delle zone ha la precedenza sulla zona vista nella foto", () => {
    let map = zoneMapFrom([]);
    for (let i = 0; i < 3; i++) map = recordZone(map, { location: "frigo", food: "cat:milk_fresh", zone: "ripiano_alto", at: `2026-11-0${i + 1}T10:00:00.000Z` });
    for (let i = 0; i < 3; i++) map = recordZone(map, { location: "frigo", food: "cat:yogurt", zone: "sportello", at: `2026-11-0${i + 1}T10:00:00.000Z` });
    const ordered = orderDifferences(diffs, "frigo", map).filter((d) => d.mode === "question");
    // il latte (L1) sta di solito sul ripiano alto anche se oggi è stato visto allo sportello
    expect(ordered[0].lotId).toBe("L1");
  });
});

describe("seconda foto", () => {
  const unseen = (ids: string[]): PantryScan => ({
    lots: FRIDGE.map((l) => (ids.includes(l.id) ? { id: l.id, status: "not_seen" as const, confidence: 0, implicit: true as const } : { id: l.id, status: "seen" as const, confidence: 0.9 })),
    unexpected: [],
    unreadable: [],
    problems: [],
  });

  it("poche voci non viste: nessun suggerimento", () => {
    expect(suggestSecondPhoto(unseen(["L1", "L2"]), FRIDGE, { location: "frigo", zoneMap: {} })).toBeNull();
    expect(suggestSecondPhoto(unseen([]), FRIDGE, { location: "frigo", zoneMap: {} })).toBeNull();
  });

  it("molte voci non viste: suggerisce la zona dove stanno di solito", () => {
    let map = zoneMapFrom([]);
    for (const food of ["cat:leafy_vegetables", "cat:cheese_fresh", "cat:yogurt"]) {
      for (let i = 0; i < 3; i++) map = recordZone(map, { location: "frigo", food, zone: "cassetto_verdure", at: `2026-11-0${i + 1}T10:00:00.000Z` });
    }
    const hint = suggestSecondPhoto(unseen(["L2", "L4", "L5"]), FRIDGE, { location: "frigo", zoneMap: map });
    expect(hint).toMatchObject({ unseen: 3, total: 6, zone: "cassetto_verdure" });
    expect(hint?.text).toContain("Mostra il cassetto della verdura");
  });

  it("senza storia suggerisce la parte illeggibile, o una foto più completa", () => {
    const withUnreadable = { ...unseen(["L1", "L2", "L3"]), unreadable: ["il fondo del frigo"] };
    expect(suggestSecondPhoto(withUnreadable, FRIDGE, { location: "frigo", zoneMap: {} })?.text).toContain("il fondo del frigo");
    const generic = suggestSecondPhoto(unseen(["L1", "L2", "L3"]), FRIDGE, { location: "frigo", zoneMap: {} });
    expect(generic?.zone).toBeUndefined();
    expect(generic?.text).toContain("3 voci su 6");
  });
});

describe("formati", () => {
  it("date e quantità", () => {
    expect(addDaysTo("2026-11-29", 2)).toBe("2026-12-01");
    expect(addDaysTo("2026-03-01", -1)).toBe("2026-02-28");
    expect(formatDay("2026-11-20")).toBe("20 nov 2026");
    expect(formatAmount(1500, "g")).toBe("1,5 kg");
    expect(formatAmount(250, "g")).toBe("250 g");
    expect(formatAmount(750, "ml")).toBe("750 ml");
    expect(formatAmount(2000, "ml")).toBe("2 l");
    expect(formatAmount(3, "pz")).toBe("3 pz");
  });
});
