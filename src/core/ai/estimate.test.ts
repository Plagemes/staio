import { describe, expect, it } from "vitest";
import { estimateInputTokens, estimateUsage, originOf } from "./index";

describe("originOf", () => {
  it("dà l'origine, senza percorso né parametri", () => {
    expect(originOf("https://api.example.com/v1/")).toBe("https://api.example.com");
    expect(originOf("https://api.example.com:8443/v1?x=1")).toBe("https://api.example.com:8443");
    expect(originOf("http://localhost:11434/v1")).toBe("http://localhost:11434");
  });
  it("distingue i domini, anche simili", () => {
    expect(originOf("https://api.example.com/v1")).not.toBe(originOf("https://api.example.com.evil.io/v1"));
    expect(originOf("https://api.example.com")).not.toBe(originOf("http://localhost"));
  });
  it("undefined se l'indirizzo non va bene", () => {
    expect(originOf("boh")).toBeUndefined();
    expect(originOf("http://x.example.com")).toBeUndefined();
  });
});

describe("stime prudenti dell'uso", () => {
  const image = (chars: number) => ({ mediaType: "image/jpeg" as const, dataBase64: "A".repeat(chars) });
  const base = { instructions: "x".repeat(300), text: "y".repeat(30), images: [], maxOutputTokens: 8000 };

  it("l'ingresso conta il testo inviato, con un token ogni tre caratteri", () => {
    expect(estimateInputTokens(base)).toBe(110);
  });
  it("ogni immagine costa almeno un minimo, e cresce con la dimensione", () => {
    expect(estimateInputTokens({ ...base, images: [image(10)] })).toBe(110 + 1600);
    expect(estimateInputTokens({ ...base, images: [image(1_000_000)] })).toBe(110 + 4000);
    expect(estimateInputTokens({ ...base, images: [image(10), image(10)] })).toBe(110 + 3200);
  });
  it("l'uscita è il massimo richiesto", () => {
    expect(estimateUsage(base)).toEqual({ inputTokens: 110, outputTokens: 8000 });
    expect(estimateUsage({ ...base, maxOutputTokens: -5 }).outputTokens).toBe(0);
  });
});
