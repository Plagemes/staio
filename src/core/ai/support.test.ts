import { describe, expect, it } from "vitest";
import {
  addCall,
  checkBudget,
  emptyUsage,
  estimateCost,
  fitWithin,
  formatCost,
  normalizeBaseUrl,
  normalizePriceList,
  normalizeUsage,
  parseDecimal,
  readCentsField,
  redactSecrets,
  usageForMonth,
} from "./index";

describe("parseDecimal", () => {
  it.each([
    ["1,29", 1.29],
    ["1.29", 1.29],
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["€ 3,50", 3.5],
    ["3,50 EUR", 3.5],
    ["0,30-", -0.3],
    ["-0,30", -0.3],
    ["1.234.567", 1234567],
    ["0,532", 0.532],
    [12, 12],
  ])("%j", (input, expected) => expect(parseDecimal(input)).toBeCloseTo(expected, 6));
  it.each(["", "abc", "1,2,x", null, undefined, NaN, {}])("scarta %j", (input) => expect(parseDecimal(input)).toBeUndefined());
});

describe("readCentsField", () => {
  it("prende gli interi come centesimi e i decimali come euro", () => {
    expect(readCentsField(129)).toBe(129);
    expect(readCentsField("129")).toBe(129);
    expect(readCentsField(-47)).toBe(-47);
    expect(readCentsField(1.29)).toBe(129);
    expect(readCentsField("1,29")).toBe(129);
    expect(readCentsField("-0,47")).toBe(-47);
    expect(readCentsField("boh")).toBeUndefined();
  });
});

describe("costo", () => {
  const list = normalizePriceList({
    "modello-a": { inputPerMTok: 2, outputPerMTok: 10 },
    "modello-b": { inputPerMTok: "0,10", outputPerMTok: "0,5" },
    rotto: { inputPerMTok: -1, outputPerMTok: 1 },
    vuoto: {},
    "": { inputPerMTok: 1, outputPerMTok: 1 },
  });

  it("scarta le voci non valide e accetta numeri scritti con la virgola", () => {
    expect(Object.keys(list).sort()).toEqual(["modello-a", "modello-b"]);
    expect(list["modello-b"]).toEqual({ inputPerMTok: 0.1, outputPerMTok: 0.5 });
    expect(normalizePriceList("x")).toEqual({});
    expect(normalizePriceList(null)).toEqual({});
  });

  it("stima dai token e dal listino", () => {
    expect(estimateCost({ inputTokens: 3000, outputTokens: 1500 }, "modello-a", list)).toBeCloseTo(0.021, 9);
  });

  it("con il listino vuoto, o un modello assente, il costo è sconosciuto", () => {
    expect(estimateCost({ inputTokens: 1, outputTokens: 1 }, "modello-a", {})).toBeNull();
    expect(estimateCost({ inputTokens: 1, outputTokens: 1 }, "altro", list)).toBeNull();
    expect(estimateCost({ inputTokens: 1, outputTokens: 1 }, "toString", list)).toBeNull();
  });

  it("formatta gli importi piccoli con più decimali", () => {
    expect(formatCost(1.5, "USD")).toBe("1,50 USD");
    expect(formatCost(0.021, "")).toBe("0,021");
    expect(formatCost(0.0012, "USD")).toBe("0,0012 USD");
  });
});

describe("contatore mensile e tetto", () => {
  const nov = "2026-11-17T10:00:00.000Z";
  const dec = "2026-12-01T08:00:00.000Z";

  it("somma chiamate, token e costo; senza prezzo conta come non valutata", () => {
    let c = emptyUsage("2026-11");
    c = addCall(c, { inputTokens: 1000, outputTokens: 200 }, 0.01, nov);
    c = addCall(c, { inputTokens: 500, outputTokens: 100 }, null, nov);
    expect(c).toEqual({ month: "2026-11", calls: 2, inputTokens: 1500, outputTokens: 300, cost: 0.01, unpricedCalls: 1, estimatedCalls: 0 });
  });

  it("a mese nuovo riparte da zero", () => {
    const c = addCall(emptyUsage("2026-11"), { inputTokens: 10, outputTokens: 10 }, 1, nov);
    expect(usageForMonth(c, dec)).toEqual(emptyUsage("2026-12"));
    expect(addCall(c, { inputTokens: 5, outputTokens: 5 }, 2, dec)).toMatchObject({ month: "2026-12", calls: 1, cost: 2 });
  });

  it("senza tetto passa sempre", () => {
    expect(checkBudget(emptyUsage("2026-11"), nov, null, false)).toEqual({ allowed: true, remaining: null });
  });

  it("con il tetto serve il prezzo del modello", () => {
    expect(checkBudget(emptyUsage("2026-11"), nov, 5, false)).toEqual({ allowed: false, reason: "price_unknown" });
  });

  it("si ferma al tetto e riparte a mese nuovo", () => {
    const spent = { ...emptyUsage("2026-11"), cost: 5 };
    expect(checkBudget(spent, nov, 5, true)).toEqual({ allowed: false, reason: "cap_reached", spent: 5, cap: 5 });
    expect(checkBudget({ ...spent, cost: 3 }, nov, 5, true)).toEqual({ allowed: true, remaining: 2 });
    expect(checkBudget(spent, dec, 5, true)).toEqual({ allowed: true, remaining: 5 });
  });

  it("ripulisce un contatore rovinato", () => {
    expect(normalizeUsage({ month: "boh", calls: -3, inputTokens: "x", cost: NaN }, "2026-11")).toEqual(emptyUsage("2026-11"));
    expect(normalizeUsage(null, "2026-11")).toEqual(emptyUsage("2026-11"));
  });
});

describe("normalizeBaseUrl", () => {
  it("toglie la barra finale e tiene il percorso", () => {
    expect(normalizeBaseUrl(" https://api.example.com/v1/ ")).toEqual({ ok: true, url: "https://api.example.com/v1" });
    expect(normalizeBaseUrl("https://api.example.com")).toEqual({ ok: true, url: "https://api.example.com" });
  });
  it("accetta HTTP solo sul proprio computer", () => {
    expect(normalizeBaseUrl("http://localhost:11434/v1")).toEqual({ ok: true, url: "http://localhost:11434/v1" });
    expect(normalizeBaseUrl("http://127.0.0.1:8080/v1")).toMatchObject({ ok: true });
    expect(normalizeBaseUrl("http://api.example.com/v1")).toEqual({ ok: false, error: "insecure" });
  });
  it("rifiuta il resto", () => {
    expect(normalizeBaseUrl("")).toEqual({ ok: false, error: "empty" });
    expect(normalizeBaseUrl("api.example.com")).toEqual({ ok: false, error: "invalid" });
    expect(normalizeBaseUrl("ftp://x.com")).toEqual({ ok: false, error: "invalid" });
    expect(normalizeBaseUrl("https://utente:segreto@x.com/v1")).toEqual({ ok: false, error: "credentials" });
  });
  it("scarta parametri e frammenti", () => {
    expect(normalizeBaseUrl("https://x.com/v1?key=abc#frag")).toEqual({ ok: true, url: "https://x.com/v1" });
  });
});

describe("fitWithin", () => {
  const limits = { maxSide: 2000, maxPixels: 2_000_000 };
  it("non ingrandisce", () => expect(fitWithin(800, 600, limits)).toEqual({ width: 800, height: 600 }));
  it("riduce una foto grande rispettando le proporzioni e l'area", () => {
    const r = fitWithin(4000, 3000, limits);
    expect(r.width / r.height).toBeCloseTo(4 / 3, 2);
    expect(r.width * r.height).toBeLessThanOrEqual(2_000_000);
    expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(2000);
  });
  it("lascia altezza a uno scontrino lungo e stretto", () => {
    const r = fitWithin(1000, 4000, limits);
    expect(r.height).toBeLessThanOrEqual(2000);
    expect(r.height).toBeGreaterThan(r.width);
  });
  it("misure nulle", () => expect(fitWithin(0, 100, limits)).toEqual({ width: 0, height: 0 }));
});

describe("redactSecrets", () => {
  it("toglie la chiave nota ovunque compaia", () => {
    const key = "sk-ant-api03-ABCDEF123456";
    expect(redactSecrets(`invalid key ${key}, retry with ${key}`, [key])).not.toContain("ABCDEF");
  });
  it("toglie anche le forme mascherate che i fornitori ripetono", () => {
    expect(redactSecrets("Incorrect API key provided: sk-proj-****abcd. Find it at ...")).not.toContain("abcd");
    expect(redactSecrets("Authorization: Bearer abc.def.ghi failed")).not.toContain("abc.def");
  });
  it("accorcia i testi lunghi", () => {
    expect(redactSecrets("x".repeat(1000)).length).toBeLessThan(400);
  });
});
