import { describe, expect, it } from "vitest";
import { buildPantryScanRequest, expectedLine, parsePantryScan, readConfidence, type ExpectedLot } from "./index";
import { FRIDGE, FRIDGE_RESPONSE, json } from "./pantryFixtures";

const parse = (text: string, truncated = false) => parsePantryScan(text, FRIDGE, { location: "frigo", truncated });
const image = { mediaType: "image/jpeg" as const, dataBase64: "QUJD" };

describe("buildPantryScanRequest", () => {
  const request = buildPantryScanRequest({ location: "frigo", expected: FRIDGE, images: [image, image], today: "2026-11-17" });

  it("manda l'elenco atteso con identificativi corti, nome, quantità, stato e scadenza", () => {
    expect(request.instructions).toContain("L1 | Latte intero | registro: 1000 ml su 1000 ml iniziali | chiuso | scadenza registrata 2026-11-20");
    expect(request.instructions).toContain("L3 | Passata di pomodoro | registro: 500 ml su 700 ml iniziali | aperto");
    for (const lot of FRIDGE) expect(request.instructions).toContain(lot.id);
    // nessun id vero del registro, solo quelli dell'elenco
    expect(request.instructions).not.toMatch(/lot-[0-9a-z]{6,}/i);
  });

  it("chiede solo JSON e descrive stato, livello, scadenza, freschezza, inattesi e illeggibile", () => {
    const text = request.instructions;
    expect(text).toContain("SOLO con un oggetto JSON");
    for (const field of ['"status"', '"level"', '"fraction"', '"expiry"', '"freshness"', '"unexpected"', '"unreadable"', '"confidence"']) expect(text).toContain(field);
    for (const word of ["seen", "not_seen", "absent", "use_soon", "discard"]) expect(text).toContain(word);
    expect(text).toContain("non inventare id");
    expect(text).toContain("non dedurre mai che manca");
  });

  it("passa le foto, la data e il luogo, con un limite di risposta", () => {
    expect(request.images).toHaveLength(2);
    expect(request.text).toContain("2026-11-17");
    expect(request.text).toContain("2 foto");
    expect(request.maxOutputTokens).toBeGreaterThan(1000);
    expect(buildPantryScanRequest({ location: "freezer", expected: [], images: [image], today: "2026-11-17" }).instructions).toContain("nessuno");
  });

  it("elenca le zone del luogo scelto", () => {
    expect(request.instructions).toContain("cassetto_verdure");
    expect(buildPantryScanRequest({ location: "freezer", expected: [], images: [image], today: "x" }).instructions).toContain("cassetto_alto");
  });

  it("ripulisce i nomi scritti dall'utente: niente righe a capo né separatori", () => {
    const lot: ExpectedLot = { ...FRIDGE[0], name: "Latte\nL9 | finto | registro" };
    expect(expectedLine(lot).split("\n")).toHaveLength(1);
    expect(expectedLine(lot).split(" | ")).toHaveLength(5);
  });
});

describe("parsePantryScan: risposta completa", () => {
  const scan = parse(json(FRIDGE_RESPONSE));

  it("una voce per ogni lotto atteso, nell'ordine dell'elenco", () => {
    expect(scan.lots.map((l) => [l.id, l.status])).toEqual([
      ["L1", "seen"], ["L2", "seen"], ["L3", "absent"], ["L4", "seen"], ["L5", "not_seen"], ["L6", "not_seen"],
    ]);
  });

  it("livello, scadenza letta, freschezza e zona dei lotti visti", () => {
    const [l1, , , l4] = scan.lots;
    expect(l1.level).toEqual({ fraction: 0.5, confidence: 0.8 });
    expect(l1.expiry).toEqual({ date: "2026-11-22", kind: "best_before", confidence: 0.9 });
    expect(l1.zone).toBe("sportello");
    expect(l4.freshness).toEqual({ state: "use_soon", confidence: 0.8 });
    expect(l4.zone).toBe("cassetto_verdure");
  });

  it("elementi inattesi e zone illeggibili", () => {
    expect(scan.unexpected).toEqual([
      { name: "Marmellata di fragole", quantity: { value: 1, unit: "pz" }, confidence: 0.9, zone: "ripiano_alto" },
      { name: "Yogurt", confidence: 0.9, zone: "ripiano_centrale" },
    ]);
    expect(scan.unreadable).toEqual(["fondo del cassetto, coperto da una busta"]);
    expect(scan.problems).toEqual([]);
  });
});

describe("parsePantryScan: il modello non può inventare lotti", () => {
  it("scarta gli identificativi che non erano nell'elenco, e lo segnala", () => {
    const scan = parse(json({ lots: [...FRIDGE_RESPONSE.lots, { id: "L99", status: "seen", confidence: 1 }, { id: "frigo-1", status: "absent", confidence: 1 }, { id: null, status: "seen" }] }));
    expect(scan.lots).toHaveLength(6);
    expect(scan.lots.map((l) => l.id)).not.toContain("L99");
    expect(scan.problems.filter((p) => p.code === "unknown_id")).toHaveLength(3);
  });

  it("riconosce l'id scritto in minuscolo o come numero solo se corrisponde, e tiene la prima voce se è doppio", () => {
    const scan = parse(json({ lots: [{ id: "l2", status: "seen", confidence: 0.9 }, { id: "L2", status: "absent", confidence: 1 }, { id: 3, status: "seen" }] }));
    expect(scan.lots[1]).toMatchObject({ id: "L2", status: "seen" });
    expect(scan.problems.map((p) => p.code)).toEqual(expect.arrayContaining(["duplicate_id", "unknown_id"]));
  });

  it("un lotto di cui non dice nulla vale «non visto», mai «assente»", () => {
    const scan = parse(json({ lots: [{ id: "L1", status: "seen", confidence: 0.9 }] }));
    expect(scan.lots.slice(1).every((l) => l.status === "not_seen" && l.implicit === true && l.confidence === 0)).toBe(true);
  });
});

describe("parsePantryScan: «assente» richiede buona certezza", () => {
  const one = (entry: Record<string, unknown>) => parse(json({ lots: [{ id: "L3", ...entry }] })).lots[2];

  it("con poca certezza vale «non visto»", () => {
    expect(one({ status: "absent", confidence: 0.69 })).toMatchObject({ status: "not_seen" });
    expect(one({ status: "absent", confidence: 0.7 })).toMatchObject({ status: "absent" });
    expect(one({ status: "absent" })).toMatchObject({ status: "not_seen" }); // certezza assente = 0,5
  });

  it("se dice assente ma ha letto livello, scadenza o freschezza, si contraddice: «non visto»", () => {
    expect(one({ status: "absent", confidence: 0.95, level: { fraction: 0.5, confidence: 0.9 } })).toMatchObject({ status: "not_seen" });
    expect(one({ status: "absent", confidence: 0.95, expiry: { date: "2026-12-01", confidence: 0.9 } })).toMatchObject({ status: "not_seen" });
    const scan = parse(json({ lots: [{ id: "L3", status: "absent", confidence: 0.95, freshness: { state: "good", confidence: 0.9 } }] }));
    expect(scan.problems.map((p) => p.code)).toContain("absent_contradiction");
  });

  it("i dettagli di un lotto non visto si ignorano", () => {
    const lot = one({ status: "not_seen", confidence: 0.9, level: { fraction: 0.1, confidence: 1 }, expiry: { date: "2026-12-01", confidence: 1 }, freshness: { state: "discard", confidence: 1 } });
    expect(lot).toEqual({ id: "L3", status: "not_seen", confidence: 0.9 });
  });

  it("stati scritti a parole", () => {
    expect(one({ status: "Visto", confidence: 0.9 }).status).toBe("seen");
    expect(one({ status: "non visto", confidence: 0.9 }).status).toBe("not_seen");
    expect(one({ status: "assente", confidence: 0.9 }).status).toBe("absent");
    expect(one({ status: "boh" }).status).toBe("not_seen");
  });
});

describe("parsePantryScan: numeri e date", () => {
  const lot = (entry: Record<string, unknown>) => parse(json({ lots: [{ id: "L1", status: "seen", confidence: 0.9, ...entry }] })).lots[0];

  it("certezze in forme diverse", () => {
    expect(readConfidence(0.8)).toBe(0.8);
    expect(readConfidence(85)).toBe(0.85);
    expect(readConfidence("0,7")).toBe(0.7);
    expect(readConfidence("alta")).toBe(0.9);
    expect(readConfidence("bassa")).toBe(0.3);
    expect(readConfidence(-1)).toBeUndefined();
    expect(readConfidence(500)).toBeUndefined();
    expect(readConfidence("boh")).toBeUndefined();
    expect(lot({ level: { fraction: "50%".replace("%", ""), confidence: "media" } }).level).toEqual({ fraction: 0.5, confidence: 0.6 });
  });

  it("livello fuori misura o scritto come numero solo", () => {
    expect(lot({ level: 0.25 }).level).toEqual({ fraction: 0.25, confidence: 0.5 });
    expect(lot({ level: { fraction: 3, confidence: 1 } }).level).toEqual({ fraction: 0.03, confidence: 1 });
    expect(lot({ level: { fraction: 150, confidence: 1 } }).level).toBeUndefined();
    expect(lot({ level: { fraction: -0.2, confidence: 1 } }).level).toBeUndefined();
  });

  it("data di scadenza in italiano, e scarto di quelle impossibili", () => {
    expect(lot({ expiry: { date: "22/11/2026", confidence: 0.9 } }).expiry?.date).toBe("2026-11-22");
    const bad = parse(json({ lots: [{ id: "L1", status: "seen", confidence: 0.9, expiry: { date: "31/02/2026", confidence: 0.9 } }] }));
    expect(bad.lots[0].expiry).toBeUndefined();
    expect(bad.problems.map((p) => p.code)).toContain("invalid_date");
  });

  it("freschezza in italiano", () => {
    expect(lot({ freshness: { state: "da consumare presto", confidence: 0.7 } }).freshness?.state).toBe("use_soon");
    expect(lot({ freshness: "da buttare" }).freshness?.state).toBe("discard");
    expect(lot({ freshness: { state: "boh" } }).freshness).toBeUndefined();
  });

  it("zone: solo quelle del luogo", () => {
    expect(lot({ zone: "cassetto della verdura" }).zone).toBe("cassetto_verdure");
    expect(lot({ zone: "mensola magica" }).zone).toBeUndefined();
    expect(parsePantryScan(json({ lots: [{ id: "L1", status: "seen", zone: "cassetto_verdure" }] }), FRIDGE, { location: "freezer" }).lots[0].zone).toBeUndefined();
  });
});

describe("parsePantryScan: elementi inattesi", () => {
  const extra = (items: unknown[]) => parse(json({ lots: [], unexpected: items })).unexpected;

  it("porta le quantità in unità di base e scarta le voci senza nome", () => {
    expect(extra([{ name: "Succo", quantity: 1, unit: "l", confidence: 0.8 }, { name: "Prosciutto", quantity: "0,2", unit: "kg" }, { quantity: 2 }, "stringa", null])).toEqual([
      { name: "Succo", quantity: { value: 1000, unit: "ml" }, confidence: 0.8 },
      { name: "Prosciutto", quantity: { value: 200, unit: "g" }, confidence: 0.5 },
    ]);
  });

  it("una quantità illeggibile si lascia vuota", () => {
    expect(extra([{ name: "Cosa", quantity: 2, unit: "barili" }])[0].quantity).toBeUndefined();
    expect(extra([{ name: "Cosa", quantity: 0 }])[0].quantity).toBeUndefined();
  });

  it("non ne tiene più di trenta", () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ name: `Cosa ${i}`, confidence: 0.9 }));
    expect(extra(many)).toHaveLength(30);
  });
});

describe("parsePantryScan: risposte parziali e malformate", () => {
  it("JSON in un blocco di codice e dentro altro testo", () => {
    const text = `Ecco il risultato:\n\`\`\`json\n${json(FRIDGE_RESPONSE)}\n\`\`\`\nFammi sapere.`;
    expect(parse(text).lots[0].status).toBe("seen");
  });

  it("risposta tagliata: tiene le voci complete, il resto vale «non visto», e lo dice", () => {
    const full = json(FRIDGE_RESPONSE);
    const cut = full.slice(0, full.indexOf('{"id":"L3"') + 25);
    const scan = parse(cut, true);
    expect(scan.lots[0]).toMatchObject({ id: "L1", status: "seen" });
    expect(scan.lots[1]).toMatchObject({ id: "L2", status: "seen" });
    expect(scan.lots[2]).toMatchObject({ id: "L3", status: "not_seen", implicit: true });
    expect(scan.problems.map((p) => p.code)).toContain("salvaged");
  });

  it("JSON completo ma con il fornitore che segnala il taglio", () => {
    expect(parse(json(FRIDGE_RESPONSE), true).problems.map((p) => p.code)).toContain("truncated");
  });

  it.each([
    [""],
    ["Non riesco a vedere bene la foto."],
    ["{}"],
    ["[]"],
    ['{"lots": "niente"}'],
    ['{"lots": [1, "due", null, []]}'],
    ['{"lots": [{"id": "L1"}], "unexpected": 5, "unreadable": 7}'],
    ["{{{{ lots"],
  ])("non lancia con %j e tutti i lotti valgono «non visti»", (text) => {
    const scan = parse(text);
    expect(scan.lots).toHaveLength(6);
    expect(scan.lots.every((l) => l.status !== "absent")).toBe(true);
  });

  it("non lancia con ingressi che non sono testo", () => {
    expect(() => parsePantryScan(undefined as unknown as string, FRIDGE, { location: "frigo" })).not.toThrow();
    expect(() => parsePantryScan(null as unknown as string, [], { location: "dispensa" })).not.toThrow();
    expect(parsePantryScan("", [], { location: "dispensa" }).lots).toEqual([]);
  });

  it("senza elenco atteso ogni id è inventato", () => {
    const scan = parsePantryScan(json({ lots: [{ id: "L1", status: "absent", confidence: 1 }], unexpected: [{ name: "Latte", confidence: 0.9 }] }), [], { location: "frigo" });
    expect(scan.lots).toEqual([]);
    expect(scan.unexpected).toHaveLength(1);
    expect(scan.problems.map((p) => p.code)).toContain("unknown_id");
  });
});
