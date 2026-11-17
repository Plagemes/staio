import { describe, expect, it } from "vitest";
import * as route from "@/app/api/ricetta/route";

// Questi test non toccano la rete: ogni richiesta è rifiutata prima di qualunque risoluzione.
describe("rotta /api/ricetta", () => {
  it("espone solo POST e il tempo massimo, senza dichiarare l'ambiente Edge", () => {
    expect(Object.keys(route).sort()).toEqual(["POST", "maxDuration"]);
    expect(typeof route.POST).toBe("function");
    expect(route.maxDuration).toBeGreaterThanOrEqual(10);
    // Con Cache Components `runtime` non è ammesso: il gestore Node è quello predefinito.
    expect("runtime" in route).toBe(false);
  });

  it("rifiuta un indirizzo non https senza uscire sulla rete", async () => {
    const r = await route.POST(
      new Request("https://app.example.org/api/ricetta", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://app.example.org", "x-forwarded-for": "203.0.113.77" },
        body: JSON.stringify({ url: "http://ricette.example.com/torta" }),
      }),
    );
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ ok: false, error: { code: "not_https" } });
  });

  it("rifiuta gli indirizzi locali senza uscire sulla rete", async () => {
    const r = await route.POST(
      new Request("https://app.example.org/api/ricetta", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://app.example.org", "x-forwarded-for": "203.0.113.78" },
        body: JSON.stringify({ url: "https://169.254.169.254/latest/meta-data/" }),
      }),
    );
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ ok: false, error: { code: "address_not_allowed" } });
  });
});
