import { describe, expect, it } from "vitest";
import { findLinks, hasSharedContent, readHttpLink, readShared, videoPlatform } from "./links";

const params = (o: Record<string, string>) => new URLSearchParams(o);

describe("readShared", () => {
  it("prende il link dal parametro url e lascia il testo come didascalia", () => {
    const s = readShared(params({ title: "Pasta", text: "Ingredienti\n200 g pasta", url: "https://www.instagram.com/reel/abc/" }));
    expect(s.link).toBe("https://www.instagram.com/reel/abc/");
    expect(s.title).toBe("Pasta");
    expect(s.caption).toBe("Ingredienti\n200 g pasta");
  });

  it("Android: il link sta dentro il testo", () => {
    const s = readShared(params({ text: "Guarda che pasta! https://vm.tiktok.com/ZMabc123/ " }));
    expect(s.link).toBe("https://vm.tiktok.com/ZMabc123/");
    expect(s.caption).toBe("Guarda che pasta!");
  });

  it("solo link nel testo: nessuna didascalia", () => {
    const s = readShared(params({ text: "https://www.instagram.com/reel/abc/?igsh=xyz" }));
    expect(s.link).toBe("https://www.instagram.com/reel/abc/?igsh=xyz");
    expect(s.caption).toBe("");
  });

  it("il link può stare nel titolo", () => {
    const s = readShared(params({ title: "https://youtu.be/abc123" }));
    expect(s.link).toBe("https://youtu.be/abc123");
    expect(s.title).toBe("");
  });

  it("il parametro url ha la precedenza; i link non restano nella didascalia", () => {
    const s = readShared(params({ url: "https://youtu.be/uno", text: "Bello https://youtu.be/uno e anche https://altro.example/x" }));
    expect(s.link).toBe("https://youtu.be/uno");
    expect(s.caption).toBe("Bello e anche");
  });

  it("toglie la punteggiatura finale dal link nel testo", () => {
    const s = readShared(params({ text: "Vedi (https://youtu.be/abc)." }));
    expect(s.link).toBe("https://youtu.be/abc");
  });

  it("ignora indirizzi non http, con credenziali o senza dominio", () => {
    expect(readShared(params({ url: "javascript:alert(1)" })).link).toBeUndefined();
    expect(readShared(params({ url: "https://utente:pw@instagram.com/x" })).link).toBeUndefined();
    expect(readShared(params({ url: "https://localhost/x" })).link).toBeUndefined();
    expect(readShared(params({ url: "intent://x#Intent;end" })).link).toBeUndefined();
  });

  it("senza parametri non c'è niente", () => {
    expect(hasSharedContent(readShared(params({})))).toBe(false);
    expect(hasSharedContent(readShared(params({ text: "ciao" })))).toBe(true);
  });

  it("limita la lunghezza e toglie i caratteri di controllo", () => {
    const s = readShared(params({ text: `a${String.fromCharCode(0)}b${"x".repeat(50_000)}`, title: "t".repeat(1000) }));
    expect(s.caption.length).toBeLessThanOrEqual(20_000);
    expect(s.caption).not.toContain(String.fromCharCode(0));
    expect(s.title.length).toBeLessThanOrEqual(300);
  });
});

describe("findLinks e readHttpLink", () => {
  it("trova tutti i link nell'ordine", () => {
    expect(findLinks("a http://uno.it/x, poi https://due.it/y!")).toEqual(["http://uno.it/x", "https://due.it/y"]);
  });
  it("rifiuta indirizzi troppo lunghi", () => {
    expect(readHttpLink(`https://a.it/${"x".repeat(3000)}`)).toBeUndefined();
  });
});

describe("videoPlatform", () => {
  it("riconosce le piattaforme e i sottodomini", () => {
    expect(videoPlatform("https://www.instagram.com/reel/x/")).toBe("instagram");
    expect(videoPlatform("https://instagram.com/p/x")).toBe("instagram");
    expect(videoPlatform("https://vm.tiktok.com/abc")).toBe("tiktok");
    expect(videoPlatform("https://www.tiktok.com/@a/video/1")).toBe("tiktok");
    expect(videoPlatform("https://m.youtube.com/watch?v=1")).toBe("youtube");
    expect(videoPlatform("https://youtu.be/1")).toBe("youtube");
    expect(videoPlatform("https://YOUTU.BE./1")).toBe("youtube");
  });
  it("non si lascia ingannare da domini simili, http o credenziali", () => {
    expect(videoPlatform("https://instagram.com.evil.example/x")).toBeUndefined();
    expect(videoPlatform("https://notinstagram.com/x")).toBeUndefined();
    expect(videoPlatform("https://evil.example/?u=https://instagram.com/x")).toBeUndefined();
    expect(videoPlatform("https://instagram.com@evil.example/x")).toBeUndefined();
    expect(videoPlatform("http://www.instagram.com/x")).toBeUndefined();
    expect(videoPlatform("non un indirizzo")).toBeUndefined();
  });
});
