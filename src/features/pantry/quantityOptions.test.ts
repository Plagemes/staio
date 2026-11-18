import { describe, expect, it } from "vitest";
import { derivePantry, type LedgerEvent, type Lot, type Pieces, type Unit } from "@/core/ledger";
import { consume, purchase, q } from "@/core/ledger/test-helpers";
import { resolveAmount } from "../actions";
import { amountFor, amountLabel, quantityOptions, remembersPortion } from "./quantityOptions";

const AT = "2026-11-16T10:00:00.000Z";
const LATER = "2026-11-16T12:00:00.000Z";

function lotOf(name: string, value: number, unit: Unit = "g", extra: { pieces?: Pieces; eaten?: number; lotId?: string } = {}): Lot {
  const lotId = extra.lotId ?? "L1";
  const events: LedgerEvent[] = [
    purchase(`p-${lotId}`, AT, { lotId, productRef: name, quantity: q(value, unit), location: "frigo", ...(extra.pieces ? { pieces: extra.pieces } : {}) }),
  ];
  if (extra.eaten) events.push(consume(`c-${lotId}`, LATER, { lotId, quantity: q(extra.eaten, unit) }));
  return derivePantry(events).lots[0];
}

const ids = (lot: Lot, more: Omit<Parameters<typeof quantityOptions>[0], "lot"> = {}) => quantityOptions({ lot, ...more }).options.map((o) => o.id);
const labels = (lot: Lot, more: Omit<Parameters<typeof quantityOptions>[0], "lot"> = {}) => quantityOptions({ lot, ...more }).options.map((o) => o.label);

const PIADINE: Pieces = { count: 2, each: 100, name: "piadina" };

describe("pastiglie e scelta di partenza", () => {
  it("1. alimento a peso senza porzione ricordata: metà e tutto, nessuna scelta", () => {
    const pollo = lotOf("Petto di pollo", 400);
    const { options, initial } = quantityOptions({ lot: pollo });
    expect(options.map((o) => [o.id, o.label, o.value, o.estimated ?? false])).toEqual([
      ["half", "~Metà (200 g)", 200, true],
      ["all", "Tutto (400 g)", 400, false],
    ]);
    expect(initial).toBeNull();
  });

  it("1. vale anche per i liquidi", () => {
    const latte = lotOf("Latte", 1000, "ml");
    expect(labels(latte)).toEqual(["~Metà (0,5 l)", "Tutto (1 l)"]);
    expect(quantityOptions({ lot: latte }).initial).toBeNull();
  });

  it("2. alimento a pezzi: parte da un pezzo, la mezza è una stima, metà e tutto sono doppioni", () => {
    const piadine = lotOf("Piadine", 200, "g", { pieces: PIADINE });
    const { options, initial } = quantityOptions({ lot: piadine });
    expect(options.map((o) => [o.id, o.label, o.value, o.estimated ?? false])).toEqual([
      ["pieces-1", "Una piadina", 100, false],
      ["pieces-2", "2 piadine", 200, false],
      ["pieces-half", "Mezza piadina", 50, true],
    ]);
    expect(initial).toEqual({ value: 100, estimated: false, optionId: "pieces-1" });
  });

  it("2. al massimo due scelte intere più la mezza", () => {
    const fette = lotOf("Pane a fette", 600, "g", { pieces: { count: 6, each: 100, name: "fetta" } });
    expect(labels(fette)).toEqual(["Una fetta", "2 fette", "Mezza fetta", "~Metà (300 g)", "Tutto (600 g)"]);
  });

  it("2. resta solo mezzo pezzo: si parte da quello", () => {
    const piadine = lotOf("Piadine", 200, "g", { pieces: PIADINE, eaten: 150 });
    const { options, initial } = quantityOptions({ lot: piadine });
    expect(options.map((o) => o.id)).toEqual(["pieces-half", "half"]);
    expect(initial).toEqual({ value: 50, estimated: true, optionId: "pieces-half" });
  });

  it("3. uova: «1 pz», «2 pz», tutto; parte da «1 pz»", () => {
    const uova = lotOf("Uova", 6, "pz");
    const { options, initial } = quantityOptions({ lot: uova });
    expect(options.map((o) => o.label)).toEqual(["1 pz", "2 pz", "Tutto (6 pz)"]);
    expect(initial).toEqual({ value: 1, estimated: false, optionId: "count-1" });
  });

  it("3. un solo uovo: una pastiglia sola, niente «2 pz» né «Tutto» doppio", () => {
    const uovo = lotOf("Uova", 6, "pz", { eaten: 5 });
    expect(ids(uovo)).toEqual(["count-1"]);
    expect(quantityOptions({ lot: uovo }).initial?.optionId).toBe("count-1");
  });

  it("4. tre confezioni uguali senza pezzi: «1 confezione» e «Tutte (3)», nessuna già scelta", () => {
    const group = [1, 2, 3].map((n) => lotOf("Yogurt", 125, "g", { lotId: `Y${n}` }));
    const { options, initial } = quantityOptions({ lot: group[0], group });
    expect(options.map((o) => [o.id, o.label, o.value])).toEqual([
      ["pack-one", "1 confezione", 125],
      ["pack-all", "Tutte (3)", 375],
    ]);
    expect(initial).toBeNull();
  });

  it("4. tre confezioni uguali con i pezzi: parte dal pezzo", () => {
    const group = [1, 2, 3].map((n) => lotOf("Piadine", 400, "g", { lotId: `P${n}`, pieces: { count: 4, each: 100, name: "piadina" } }));
    const { options, initial } = quantityOptions({ lot: group[0], group });
    expect(options.map((o) => o.label)).toEqual(["Una piadina", "2 piadine", "Mezza piadina", "1 confezione", "Tutte (3)"]);
    expect(initial?.optionId).toBe("pieces-1");
  });

  it("4. tre confezioni di uova: si contano i pezzi, poi le confezioni", () => {
    const group = [1, 2, 3].map((n) => lotOf("Uova", 6, "pz", { lotId: `U${n}` }));
    const { options, initial } = quantityOptions({ lot: group[0], group });
    expect(options.map((o) => o.label)).toEqual(["1 pz", "2 pz", "1 confezione", "Tutte (3)"]);
    expect(initial?.optionId).toBe("count-1");
  });

  it("5. «Il solito» è il primo ed è la scelta di partenza", () => {
    const pollo = lotOf("Petto di pollo", 400);
    const { options, initial } = quantityOptions({ lot: pollo, usual: q(150) });
    expect(options.map((o) => o.label)).toEqual(["Il solito (150 g)", "~Metà (200 g)", "Tutto (400 g)"]);
    expect(initial).toEqual({ value: 150, estimated: false, optionId: "usual" });
  });

  it("5. porzione ricordata maggiore del rimasto, o in un'altra unità: «Il solito» non compare", () => {
    const pollo = lotOf("Petto di pollo", 400, "g", { eaten: 300 });
    expect(ids(pollo, { usual: q(150) })).toEqual(["half", "all"]);
    expect(ids(pollo, { usual: q(100, "ml") })).toEqual(["half", "all"]);
    expect(ids(pollo, { usual: q(0) })).toEqual(["half", "all"]);
    expect(quantityOptions({ lot: pollo, usual: q(150) }).initial).toBeNull();
    // fino al rimasto compreso sì, ma senza sceglierlo: vale quanto «Tutto»
    expect(ids(pollo, { usual: q(100) })).toEqual(["usual", "half"]);
    expect(quantityOptions({ lot: pollo, usual: q(100) }).initial).toBeNull();
  });

  it("5. «Il solito» che vale tutta la confezione si mostra ma non parte già scelto", () => {
    // ieri 400 g scritti a mano, oggi una confezione nuova da 400 g
    const pollo = lotOf("Petto di pollo", 400);
    const whole = quantityOptions({ lot: pollo, usual: q(400) });
    expect(whole.options.map((o) => o.label)).toEqual(["Il solito (400 g)", "~Metà (200 g)"]);
    expect(whole.initial).toBeNull();
    // appena sotto il rimasto sì
    expect(quantityOptions({ lot: pollo, usual: q(399) }).initial?.optionId).toBe("usual");

    // nei gruppi «Il solito» che vale una confezione parte già scelto (non è tutto il rimasto), e «1 confezione» non si ripete
    const yogurt = [1, 2, 3].map((n) => lotOf("Yogurt", 125, "g", { lotId: `Y${n}` }));
    const packs = quantityOptions({ lot: yogurt[0], group: yogurt, usual: q(125) });
    expect(packs.options.map((o) => o.label)).toEqual(["Il solito (125 g)", "Tutte (3)"]);
    expect(packs.initial).toEqual({ value: 125, estimated: false, optionId: "usual" });

    // ma se il solito vale tutte le confezioni, no
    const mousse = [1, 2].map((n) => lotOf("Mousse", 170, "g", { lotId: `M${n}` }));
    expect(quantityOptions({ lot: mousse[0], group: mousse, usual: q(340) }).initial).toBeNull();

    // uova: «Il solito» che le finisce non si sceglie da solo, si riparte da «1 pz»
    const uova = quantityOptions({ lot: lotOf("Uova", 6, "pz", { eaten: 4 }), usual: q(2, "pz") });
    expect(uova.options.map((o) => o.id)).toEqual(["usual", "count-1"]);
    expect(uova.initial?.optionId).toBe("count-1");

    // pezzi: se l'ultima piadina è anche «Il solito», non si ripiega sulla mezza
    const ultima = quantityOptions({ lot: lotOf("Piadine", 200, "g", { pieces: PIADINE, eaten: 100 }), usual: q(100) });
    expect(ultima.options.map((o) => o.id)).toEqual(["usual", "pieces-half"]);
    expect(ultima.initial).toBeNull();
  });

  it("5. «Il solito» stimato resta una stima: tilde sulla pastiglia e consumo stimato", () => {
    const piadine = lotOf("Piadine", 200, "g", { pieces: PIADINE });
    const { options, initial } = quantityOptions({ lot: piadine, usual: { value: 50, unit: "g", estimated: true } });
    expect(options[0]).toMatchObject({ id: "usual", label: "Il solito (~50 g)", value: 50, estimated: true, summary: "~50 g" });
    expect(options.map((o) => o.id)).toEqual(["usual", "pieces-1", "pieces-2"]);
    expect(initial).toEqual({ value: 50, estimated: true, optionId: "usual" });
    expect(resolveAmount(piadine, amountFor(initial!).choice)).toMatchObject({ ok: true, quantity: { value: 50, unit: "g" }, certainty: "estimated" });
    expect(amountLabel("Mangiato", initial, options, "g")).toBe("Mangiato · ~50 g");
  });

  it("5. «Il solito» vince sui pezzi come partenza", () => {
    const piadine = lotOf("Piadine", 200, "g", { pieces: PIADINE });
    const { options, initial } = quantityOptions({ lot: piadine, usual: q(150) });
    expect(options.map((o) => o.id)).toEqual(["usual", "pieces-1", "pieces-2", "pieces-half"]);
    expect(initial?.optionId).toBe("usual");
  });

  it("niente doppioni: resta la prima pastiglia con quel valore", () => {
    const piadine = lotOf("Piadine", 200, "g", { pieces: PIADINE });
    // il solito è proprio una piadina
    expect(labels(piadine, { usual: q(100) })).toEqual(["Il solito (100 g)", "2 piadine", "Mezza piadina"]);
    // il solito è proprio la metà
    expect(labels(lotOf("Riso", 400), { usual: q(200) })).toEqual(["Il solito (200 g)", "Tutto (400 g)"]);
    // una confezione da due pezzi: «2 piadine» è già la confezione
    const group = [1, 2].map((n) => lotOf("Piadine", 200, "g", { lotId: `P${n}`, pieces: PIADINE }));
    expect(labels(group[0], { group })).toEqual(["Una piadina", "2 piadine", "Mezza piadina", "Tutte (2)"]);
    for (const lot of [piadine, lotOf("Riso", 400), lotOf("Uova", 6, "pz")]) {
      const values = quantityOptions({ lot, usual: q(100) }).options.map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it("la partenza non è mai «Tutto», «Tutte» o «1 confezione»", () => {
    const yogurt = [1, 2, 3].map((n) => lotOf("Yogurt", 125, "g", { lotId: `Y${n}` }));
    const cases: Parameters<typeof quantityOptions>[0][] = [
      { lot: lotOf("Petto di pollo", 400) },
      { lot: lotOf("Latte", 1000, "ml") },
      { lot: lotOf("Burro", 250, "g", { eaten: 249.99 }) },
      { lot: yogurt[0], group: yogurt },
      { lot: yogurt[0], group: yogurt, usual: q(500) },
      { lot: lotOf("Uova", 6, "pz") },
      { lot: lotOf("Piadine", 200, "g", { pieces: PIADINE }) },
    ];
    for (const usual of [undefined, q(125), q(400), q(1000, "ml"), q(6, "pz")]) {
      for (const args of cases) {
        const start = quantityOptions({ ...args, ...(usual ? { usual } : {}) }).initial;
        expect(["all", "pack-all", "pack-one"]).not.toContain(start?.optionId);
        // e nemmeno su «Il solito» quando vale tutto il rimasto
        if (start?.optionId === "usual") expect(start.value).toBeLessThan(args.group ? args.group.reduce((sum, m) => sum + m.remaining, 0) : args.lot.remaining);
      }
    }
  });

  it("alimento finito: nessuna pastiglia", () => {
    const finito = lotOf("Riso", 400, "g", { eaten: 400 });
    expect(quantityOptions({ lot: finito, usual: q(80) })).toEqual({ options: [], initial: null });
  });
});

describe("dal selettore all'azione", () => {
  it("tutte le confezioni, una confezione, tutto, metà, e il resto con il suo valore", () => {
    expect(amountFor({ value: 375, estimated: false, optionId: "pack-all" })).toEqual({ target: "group", choice: { kind: "all" } });
    expect(amountFor({ value: 125, estimated: false, optionId: "pack-one" })).toEqual({ target: "lot", choice: { kind: "all" } });
    expect(amountFor({ value: 400, estimated: false, optionId: "all" })).toEqual({ target: "lot", choice: { kind: "all" } });
    expect(amountFor({ value: 200, estimated: true, optionId: "half" })).toEqual({ target: "lot", choice: { kind: "half" } });
    expect(amountFor({ value: 150, estimated: false, optionId: "usual" })).toEqual({ target: "lot", choice: { kind: "value", value: 150, estimated: false } });
    expect(amountFor({ value: 50, estimated: true, optionId: "pieces-half" })).toEqual({ target: "lot", choice: { kind: "value", value: 50, estimated: true } });
    expect(amountFor({ value: 2, estimated: false, optionId: "count-2" })).toEqual({ target: "lot", choice: { kind: "value", value: 2, estimated: false } });
    expect(amountFor({ value: 80, estimated: false })).toEqual({ target: "lot", choice: { kind: "value", value: 80, estimated: false } });
  });

  it("ciò che si legge sulla pastiglia è ciò che il registro scrive", () => {
    for (const lot of [lotOf("Petto di pollo", 333), lotOf("Latte", 1000, "ml"), lotOf("Piadine", 200, "g", { pieces: PIADINE }), lotOf("Uova", 6, "pz")]) {
      for (const option of quantityOptions({ lot, usual: { value: 1, unit: lot.unit } }).options) {
        const amount = resolveAmount(lot, amountFor({ value: option.value, estimated: option.estimated ?? false, optionId: option.id }).choice);
        expect(amount).toMatchObject({ ok: true, quantity: { value: option.value, unit: lot.unit }, certainty: option.estimated ? "estimated" : "measured" });
      }
    }
  });
});

describe("che cosa si ricorda come «Il solito»", () => {
  it("le porzioni scelte apposta e «1 confezione»: mai «Tutto», «Tutte», «~Metà»", () => {
    for (const optionId of ["all", "pack-all", "half"]) {
      expect(remembersPortion({ value: 100, estimated: optionId === "half", optionId })).toBe(false);
    }
    for (const optionId of ["pack-one", "usual", "pieces-1", "pieces-2", "pieces-half", "count-1", "count-2", undefined]) {
      expect(remembersPortion({ value: 100, estimated: false, ...(optionId ? { optionId } : {}) })).toBe(true);
    }
  });

  it("ieri «Tutto», oggi una confezione nuova: niente «Il solito», nessuna scelta già fatta", () => {
    const pollo = lotOf("Petto di pollo", 400);
    const all = quantityOptions({ lot: pollo }).options.find((o) => o.id === "all")!;
    const picked = { value: all.value, estimated: false, optionId: all.id };
    // «Tutto» non si ricorda: il giorno dopo la memoria non ha niente da proporre
    const usual = remembersPortion(picked) ? q(picked.value) : undefined;
    const next = quantityOptions({ lot: lotOf("Petto di pollo", 400, "g", { lotId: "L2" }), ...(usual ? { usual } : {}) });
    expect(next.options.map((o) => o.id)).toEqual(["half", "all"]);
    expect(next.initial).toBeNull();
  });
});

describe("«Il solito» per una confezione da una porzione", () => {
  it("la mousse ricordata con due confezioni: parte «Il solito (170 g)», «Tutte (2)» resta, nessun doppione", () => {
    const mousse = [1, 2].map((n) => lotOf("Mousse", 170, "g", { lotId: `M${n}` }));
    const { options, initial } = quantityOptions({ lot: mousse[0], group: mousse, usual: q(170) });
    expect(options.map((o) => o.label)).toEqual(["Il solito (170 g)", "Tutte (2)"]);
    expect(initial?.optionId).toBe("usual");
  });

  it("senza il solito, con una confezione ricordata la volta prima, la riga resta quella di prima", () => {
    const mousse = [1, 2].map((n) => lotOf("Mousse", 170, "g", { lotId: `M${n}` }));
    const { options, initial } = quantityOptions({ lot: mousse[0], group: mousse });
    expect(options.map((o) => o.id)).toEqual(["pack-one", "pack-all"]);
    expect(initial).toBeNull();
  });
});

describe("testo del pulsante", () => {
  const pollo = lotOf("Petto di pollo", 400);
  const piadine = lotOf("Piadine", 200, "g", { pieces: PIADINE });
  const yogurt = [1, 2, 3].map((n) => lotOf("Yogurt", 125, "g", { lotId: `Y${n}` }));
  const label = (args: Parameters<typeof quantityOptions>[0], id: string | undefined, value?: number) => {
    const { options } = quantityOptions(args);
    const option = options.find((o) => o.id === id);
    const picked = option ? { value: option.value, estimated: option.estimated ?? false, optionId: option.id } : value === undefined ? null : { value, estimated: false };
    return amountLabel("Mangiato", picked, options, args.lot.unit);
  };

  it("senza scelta c'è solo il verbo", () => {
    expect(label({ lot: pollo }, undefined)).toBe("Mangiato");
  });

  it("quantità, pezzi con il loro nome, confezioni", () => {
    expect(label({ lot: pollo, usual: q(150) }, "usual")).toBe("Mangiato · 150 g");
    expect(label({ lot: pollo }, "half")).toBe("Mangiato · ~200 g");
    expect(label({ lot: pollo }, "all")).toBe("Mangiato · 400 g");
    expect(label({ lot: pollo }, undefined, 80)).toBe("Mangiato · 80 g");
    expect(label({ lot: piadine }, "pieces-1")).toBe("Mangiato · Una piadina");
    expect(label({ lot: piadine }, "pieces-half")).toBe("Mangiato · Mezza piadina");
    expect(label({ lot: yogurt[0], group: yogurt }, "pack-one")).toBe("Mangiato · 1 confezione");
    expect(label({ lot: yogurt[0], group: yogurt }, "pack-all")).toBe("Mangiato · tutte (3)");
    expect(label({ lot: lotOf("Uova", 6, "pz") }, "count-1")).toBe("Mangiato · 1 pz");
  });
});
