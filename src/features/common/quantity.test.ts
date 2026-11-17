import { describe, expect, it } from "vitest";
import { nudge, readAmount, stepFor, writeAmount } from "./quantity";

describe("passi di «−» e «+»", () => {
  it("per unità e per valore", () => {
    expect(stepFor("pz", 3)).toBe(1);
    expect(stepFor("ml", 20)).toBe(50);
    expect(stepFor("ml", 900)).toBe(50);
    expect(stepFor("g", 0)).toBe(10);
    expect(stepFor("g", 190)).toBe(10);
    expect(stepFor("g", 200)).toBe(50);
    expect(stepFor("g", 750)).toBe(50);
  });

  it("in salita si ferma sui multipli del passo", () => {
    expect(nudge("g", 150, 1)).toBe(160);
    expect(nudge("g", 155, 1)).toBe(160);
    expect(nudge("g", 190, 1)).toBe(200);
    expect(nudge("g", 200, 1)).toBe(250);
    expect(nudge("g", 230, 1)).toBe(250);
    expect(nudge("ml", 330, 1)).toBe(350);
    expect(nudge("pz", 2, 1)).toBe(3);
    expect(nudge("pz", 0.5, 1)).toBe(1);
  });

  it("in discesa vale il passo della fascia in cui si entra", () => {
    expect(nudge("g", 200, -1)).toBe(190);
    expect(nudge("g", 250, -1)).toBe(200);
    expect(nudge("g", 210, -1)).toBe(200);
    expect(nudge("g", 155, -1)).toBe(150);
    expect(nudge("ml", 330, -1)).toBe(300);
    expect(nudge("pz", 1.5, -1)).toBe(1);
  });

  it("mai sotto il passo minimo", () => {
    expect(nudge("g", 10, -1)).toBe(10);
    expect(nudge("g", 15, -1)).toBe(10);
    expect(nudge("ml", 50, -1)).toBe(50);
    expect(nudge("pz", 1, -1)).toBe(1);
  });

  it("«−» non fa salire un valore già sotto il passo minimo", () => {
    expect(nudge("g", 6, -1)).toBe(6);
    expect(nudge("pz", 0.5, -1)).toBe(0.5);
  });

  it("senza un numero di partenza conta da zero", () => {
    expect(nudge("g", null, 1)).toBe(10);
    expect(nudge("ml", null, 1)).toBe(50);
    expect(nudge("pz", null, 1)).toBe(1);
    expect(nudge("g", null, -1)).toBe(10);
    expect(nudge("g", Number.NaN, 1)).toBe(10);
    expect(nudge("g", -30, 1)).toBe(10);
    expect(nudge("g", 0, -1)).toBe(10);
  });

  it("mai sopra ciò che resta", () => {
    expect(nudge("g", 380, 1, 400)).toBe(400);
    expect(nudge("g", 400, 1, 400)).toBe(400);
    expect(nudge("g", 350, 1, 395)).toBe(395);
    expect(nudge("g", 395, -1, 395)).toBe(350);
    expect(nudge("pz", 3, 1, 3)).toBe(3);
  });

  it("ciò che resta è meno di un passo: ci si ferma lì", () => {
    expect(nudge("g", null, 1, 6)).toBe(6);
    expect(nudge("g", null, -1, 6)).toBe(6);
    expect(nudge("g", 6, 1, 6)).toBe(6);
    expect(nudge("g", 6, -1, 6)).toBe(6);
    expect(nudge("ml", null, 1, 30)).toBe(30);
    expect(nudge("pz", null, 1, 0.5)).toBe(0.5);
  });

  it("niente code decimali", () => {
    expect(nudge("pz", 0.1 + 0.2, 1)).toBe(1);
    expect(nudge("g", 29.999999999, 1)).toBe(40);
    expect(nudge("g", 30.0000000001, -1)).toBe(20);
  });
});

describe("lettura del numero scritto a mano", () => {
  it("accetta la virgola e il punto", () => {
    expect(readAmount("150")).toBe(150);
    expect(readAmount("1,5")).toBe(1.5);
    expect(readAmount("1.5")).toBe(1.5);
    expect(readAmount(" 0,25 ")).toBe(0.25);
    expect(readAmount(",5")).toBe(0.5);
    expect(readAmount("2,")).toBe(2);
    expect(readAmount("0")).toBe(0);
  });

  it("il punto prima di tre cifre separa le migliaia", () => {
    expect(readAmount("1.500")).toBe(1500);
    expect(readAmount("12.345")).toBe(12345);
    expect(readAmount("1.500,5")).toBe(1500.5);
    expect(readAmount("1.250.000")).toBe(1250000);
    expect(readAmount("1.500,")).toBe(1500);
  });

  it("il punto resta decimale quando non può separare le migliaia", () => {
    expect(readAmount("1.5")).toBe(1.5);
    expect(readAmount("1.50")).toBe(1.5);
    expect(readAmount("1.2345")).toBe(1.2345);
    expect(readAmount("0.500")).toBe(0.5);
    expect(readAmount(".500")).toBe(0.5);
    expect(readAmount("1,500")).toBe(1.5);
    expect(readAmount("1500,5")).toBe(1500.5);
  });

  it("i casi ambigui si rifiutano", () => {
    expect(readAmount("1234.567")).toBeNull();
    expect(readAmount("00.500")).toBeNull();
    expect(readAmount("1,500.5")).toBeNull();
    expect(readAmount("1.500.5")).toBeNull();
    expect(readAmount("1.50.000")).toBeNull();
    expect(readAmount("1.500.0000")).toBeNull();
    expect(readAmount("1.500,5,5")).toBeNull();
  });

  it("testo non valido", () => {
    expect(readAmount("")).toBeNull();
    expect(readAmount("   ")).toBeNull();
    expect(readAmount("abc")).toBeNull();
    expect(readAmount("12 g")).toBeNull();
    expect(readAmount("-5")).toBeNull();
    expect(readAmount("1,2,3")).toBeNull();
    expect(readAmount("1e3")).toBeNull();
    expect(readAmount(",")).toBeNull();
  });

  it("scrive con la virgola e rilegge lo stesso numero", () => {
    expect(writeAmount(1.5)).toBe("1,5");
    expect(writeAmount(200)).toBe("200");
    expect(readAmount(writeAmount(0.25))).toBe(0.25);
    expect(writeAmount(1500)).toBe("1500");
    expect(readAmount(writeAmount(1500))).toBe(1500);
    expect(readAmount(writeAmount(1.5))).toBe(1.5);
  });
});
