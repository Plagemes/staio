import { describe, expect, it } from "vitest";
import { addressHost, addressIn, isOnlyAddress, pastedLinkTarget } from "./pastedAddress";

const RECIPE = "https://www.giallozafferano.it/ricetta/lasagne";

describe("addressIn", () => {
  it("trova il primo indirizzo", () => {
    expect(addressIn(`Lasagne ${RECIPE} e https://altro.it/x`)).toBe(RECIPE);
  });
  it("toglie la punteggiatura finale", () => {
    expect(addressIn(`Guarda ${RECIPE}.`)).toBe(RECIPE);
  });
  it("senza indirizzo o vuoto", () => {
    expect(addressIn("solo testo")).toBeUndefined();
    expect(addressIn("")).toBeUndefined();
  });
});

describe("isOnlyAddress", () => {
  it("solo l'indirizzo, con titolo o punto finale", () => {
    expect(isOnlyAddress(RECIPE)).toBe(true);
    expect(isOnlyAddress(`Pasta al forno — ${RECIPE}`)).toBe(true);
    expect(isOnlyAddress(`${RECIPE}.`)).toBe(true);
  });
  it("un paragrafo con un link dentro no", () => {
    expect(isOnlyAddress(`Ho provato questa ricetta ieri sera e mi è piaciuta molto, guarda ${RECIPE}`)).toBe(false);
  });
  it("niente indirizzo", () => {
    expect(isOnlyAddress("latte")).toBe(false);
    expect(isOnlyAddress("")).toBe(false);
  });
});

describe("pastedLinkTarget", () => {
  const enc = encodeURIComponent;
  it("https semplice porta a Importa", () => {
    expect(pastedLinkTarget(RECIPE)).toEqual({ href: `/app/ricette/importa?url=${enc(RECIPE)}`, label: "Importa la ricetta da questo indirizzo" });
  });
  it("http si propone comunque", () => {
    const http = "http://esempio.it/ricetta";
    expect(pastedLinkTarget(http)?.href).toBe(`/app/ricette/importa?url=${enc(http)}`);
  });
  it("con titolo davanti e punto finale", () => {
    expect(pastedLinkTarget(`Pasta al forno — ${RECIPE}.`)?.href).toBe(`/app/ricette/importa?url=${enc(RECIPE)}`);
  });
  it.each([
    "https://www.instagram.com/reel/abc/",
    "https://www.tiktok.com/@a/video/1",
    "https://youtu.be/abc",
    "https://www.youtube.com/watch?v=abc",
  ])("video: %s", (link) => {
    const target = pastedLinkTarget(link);
    expect(target?.label).toBe("Apri il video condiviso");
    expect(target?.href).toBe(`/app/ricette/condivisa?url=${enc(new URL(link).href)}`);
  });
  it("un dominio simile non è un video", () => {
    expect(pastedLinkTarget("https://youtube.com.esempio.it/watch")?.label).toBe("Importa la ricetta da questo indirizzo");
  });
  it("testo lungo, solo testo, vuoto: nessuna proposta", () => {
    expect(pastedLinkTarget(`Ho provato questa ricetta ieri sera e mi è piaciuta molto ${RECIPE}`)).toBeUndefined();
    expect(pastedLinkTarget("latte")).toBeUndefined();
    expect(pastedLinkTarget("")).toBeUndefined();
  });
});

describe("addressHost", () => {
  it("il dominio senza www", () => {
    expect(addressHost(RECIPE)).toBe("giallozafferano.it");
    expect(addressHost("latte")).toBeUndefined();
  });
});
