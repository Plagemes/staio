import { describe, expect, it } from "vitest";
import { EMPTY_ZONE_MAP, ZONES, foodKey, normalizeZoneMap, readZone, recordZone, usualZone, zoneMapFrom, zoneRank, type ZoneObservation } from "./index";

const obs = (zone: string, i = 0, food = "cat:yogurt", location: ZoneObservation["location"] = "frigo"): ZoneObservation => ({
  location,
  food,
  zone,
  at: `2026-11-${String(10 + i).padStart(2, "0")}T10:00:00.000Z`,
});

describe("zone dei luoghi", () => {
  it("ogni luogo ha zone con etichetta e frase «mostra»", () => {
    for (const zones of Object.values(ZONES)) {
      expect(zones.length).toBeGreaterThan(2);
      expect(new Set(zones.map((z) => z.key)).size).toBe(zones.length);
      for (const z of zones) expect(z.show.length).toBeGreaterThan(5);
    }
  });

  it("l'ordine di visita: dall'alto in basso, lo sportello dopo, le sconosciute in fondo", () => {
    expect(zoneRank("frigo", "ripiano_alto")).toBeLessThan(zoneRank("frigo", "cassetto_verdure"));
    expect(zoneRank("frigo", "cassetto_verdure")).toBeLessThan(zoneRank("frigo", "sportello"));
    expect(zoneRank("frigo", "boh")).toBe(ZONES.frigo.length);
    expect(zoneRank("frigo", undefined)).toBe(ZONES.frigo.length);
  });
});

describe("readZone", () => {
  it.each([
    ["frigo", "ripiano_alto", "ripiano_alto"],
    ["frigo", "Ripiano alto", "ripiano_alto"],
    ["frigo", "il ripiano in alto", "ripiano_alto"],
    ["frigo", "ripiano inferiore", "ripiano_basso"],
    ["frigo", "cassetto della verdura", "cassetto_verdure"],
    ["frigo", "cassetto verdure", "cassetto_verdure"],
    ["frigo", "sportello", "sportello"],
    ["frigo", "porta del frigo", "sportello"],
    ["freezer", "cassetto in basso", "cassetto_basso"],
    ["freezer", "ripiano alto", "cassetto_alto"],
    ["freezer", "cassetto centrale", "cassetto_centrale"],
    ["dispensa", "ripiano centrale", "ripiano_centrale"],
    ["dispensa", "cassetto", "cassetto"],
  ] as const)("%s: %j -> %s", (location, text, expected) => expect(readZone(location, text)).toBe(expected));

  it.each([
    ["frigo", "dietro la lattuga"],
    ["frigo", ""],
    ["frigo", 5],
    ["freezer", "cassetto della verdura"],
  ] as const)("scarta %s: %j", (location, text) => expect(readZone(location, text)).toBeUndefined());
});

describe("mappa delle zone", () => {
  it("non modifica la mappa passata", () => {
    const before = EMPTY_ZONE_MAP;
    const after = recordZone(before, obs("sportello"));
    expect(before).toEqual({});
    expect(after["frigo:cat:yogurt"].counts).toEqual({ sportello: 1 });
  });

  it("conta le conferme per luogo, alimento e zona", () => {
    const map = zoneMapFrom([obs("sportello", 0), obs("sportello", 1), obs("ripiano_alto", 2), obs("ripiano_alto", 3, "cat:milk_fresh"), obs("cassetto_alto", 4, "cat:yogurt", "freezer")]);
    expect(map["frigo:cat:yogurt"].counts).toEqual({ sportello: 2, ripiano_alto: 1 });
    expect(map["frigo:cat:milk_fresh"].counts).toEqual({ ripiano_alto: 1 });
    expect(map["freezer:cat:yogurt"].counts).toEqual({ cassetto_alto: 1 });
    expect(map["frigo:cat:yogurt"].last).toBe("2026-11-12T10:00:00.000Z");
  });

  it("ignora le zone che non esistono per il luogo e le chiavi vuote", () => {
    expect(recordZone({}, obs("cassetto_verdure", 0, "cat:x", "freezer"))).toEqual({});
    expect(recordZone({}, obs("sportello", 0, ""))).toEqual({});
    expect(recordZone({}, obs("inventata"))).toEqual({});
  });

  it("la zona abituale serve almeno un po' di storia e una zona che prevalga", () => {
    const at = (list: string[]) => usualZone(zoneMapFrom(list.map((z, i) => obs(z, i))), "frigo", "cat:yogurt");
    expect(at([])).toBeUndefined();
    expect(at(["sportello"])).toBeUndefined(); // una sola conferma non basta
    expect(at(["sportello", "sportello"])).toEqual({ zone: "sportello", count: 2, share: 1 });
    expect(at(["sportello", "sportello", "ripiano_alto"])?.zone).toBe("sportello"); // 2 su 3 = 0,67 ≥ 0,6
  });

  it("senza una zona che prevale non c'è una zona abituale", () => {
    const map = zoneMapFrom(["sportello", "sportello", "ripiano_alto", "ripiano_alto", "ripiano_basso"].map((z, i) => obs(z, i)));
    expect(usualZone(map, "frigo", "cat:yogurt")).toBeUndefined(); // 2 su 5
    expect(usualZone(map, "frigo", "cat:yogurt", { minShare: 0.3 })?.count).toBe(2);
    expect(usualZone(map, "freezer", "cat:yogurt")).toBeUndefined();
    expect(usualZone(map, "frigo", "cat:altro")).toBeUndefined();
  });

  it("con tante conferme le abitudini recenti pesano di più", () => {
    let map: ReturnType<typeof zoneMapFrom> = {};
    for (let i = 0; i < 25; i++) map = recordZone(map, obs("ripiano_alto", i % 20));
    for (let i = 0; i < 12; i++) map = recordZone(map, obs("sportello", i));
    const counts = map["frigo:cat:yogurt"].counts;
    expect(counts.ripiano_alto + counts.sportello).toBeLessThanOrEqual(30);
    // senza il dimezzamento lo sportello varrebbe 12 su 37
    expect(counts.sportello / (counts.ripiano_alto + counts.sportello)).toBeGreaterThan(12 / 37);
  });

  it("chiave dell'alimento: la categoria se c'è, altrimenti il nome", () => {
    expect(foodKey("Yogurt greco", "yogurt")).toBe("cat:yogurt");
    expect(foodKey("Yogurt Greco")).toBe("name:yogurt greco");
    expect(foodKey("Crème fraîche bio extra")).toBe("name:creme fraiche");
  });

  it("ripulisce una mappa letta dal disco", () => {
    expect(normalizeZoneMap(null)).toEqual({});
    expect(normalizeZoneMap([1])).toEqual({});
    expect(normalizeZoneMap({ "frigo:cat:yogurt": { counts: { sportello: 3, inventata: 2, ripiano_alto: -1, ripiano_basso: "x" }, last: 5 }, "altro:cat:x": { counts: { sportello: 1 } }, "frigo:cat:y": "no", "frigo:cat:z": { counts: {} } })).toEqual({
      "frigo:cat:yogurt": { counts: { sportello: 3 }, last: "" },
    });
  });
});
