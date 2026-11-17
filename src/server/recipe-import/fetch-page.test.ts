import { describe, expect, it, vi } from "vitest";
import { OUTGOING_HEADERS, UnsupportedEncodingError, fetchPage } from "./fetch-page";
import { PUBLIC_V4, chunks, enc, fakeNet, response } from "./test-helpers";

const HOST = "ricette.example.com";
const URL1 = `https://${HOST}/pasta`;
const ok = (net: ReturnType<typeof fakeNet>, url = URL1, limits = {}) => fetchPage(url, net, limits);
const fail = async (p: ReturnType<typeof fetchPage>) => {
  const r = await p;
  return r.ok ? "ok" : r.code;
};

describe("fetchPage: caso normale", () => {
  it("scarica la pagina, collegandosi all'indirizzo già controllato", async () => {
    const net = fakeNet({ [HOST]: [PUBLIC_V4] }, { [URL1]: { body: chunks("<html>", "<body>Ciao</body></html>") } });
    const r = await ok(net);
    expect(r).toEqual({ ok: true, html: "<html><body>Ciao</body></html>", finalUrl: URL1 });
    expect(net.resolve).toHaveBeenCalledWith(HOST);
    expect(net.transport).toHaveBeenCalledTimes(1);
    expect(net.transport.mock.calls[0]?.[0].address).toEqual(PUBLIC_V4);
  });

  it("invia solo le intestazioni fisse: niente cookie, credenziali o altro dell'utente", async () => {
    const net = fakeNet({ [HOST]: [PUBLIC_V4] }, { [URL1]: {} });
    await ok(net);
    const sent = net.transport.mock.calls[0]?.[0].headers ?? {};
    expect(sent).toEqual(OUTGOING_HEADERS);
    for (const k of Object.keys(sent)) expect(k).not.toMatch(/cookie|authorization|referer|origin|forwarded|x-/i);
  });

  it("legge i caratteri secondo l'intestazione o il tag meta", async () => {
    const latin1 = Uint8Array.from([0x70, 0x69, 0x73, 0x74, 0x61, 0x63, 0x63, 0x68, 0x69, 0x6f, 0x20, 0x63, 0x6f, 0x74, 0x74, 0x6f, 0x20, 0xe8]);
    const a = fakeNet({ [HOST]: [PUBLIC_V4] }, { [URL1]: { headers: { "content-type": "text/html; charset=iso-8859-1" }, body: chunks(latin1) } });
    expect((await ok(a)) as { html: string }).toMatchObject({ html: "pistacchio cotto è" });
    const meta = Uint8Array.from([...enc('<meta charset="windows-1252">caff'), 0xe8]);
    const b = fakeNet({ [HOST]: [PUBLIC_V4] }, { [URL1]: { headers: { "content-type": "text/html" }, body: chunks(meta) } });
    expect(((await ok(b)) as { html: string }).html.endsWith("caffè")).toBe(true);
    const c = fakeNet({ [HOST]: [PUBLIC_V4] }, { [URL1]: { headers: { "content-type": "text/html; charset=inventato-99" }, body: chunks("﻿ciao") } });
    expect((await ok(c)) as { html: string }).toMatchObject({ html: "ciao" });
  });
});

describe("fetchPage: solo https e indirizzi ammessi, prima di ogni rete", () => {
  it("non risolve né si collega per indirizzi non ammessi", async () => {
    const net = fakeNet({}, {});
    for (const u of ["http://ricette.example.com/", "ftp://x.example.com/", "file:///etc/passwd", "https://localhost/", "https://127.0.0.1/", "https://[::1]/", "https://2130706433/", "https://u:p@ricette.example.com/", "https://ricette.example.com:8080/", "nonunurl"]) {
      expect(await fail(fetchPage(u, net)), u).not.toBe("ok");
    }
    expect(net.resolve).not.toHaveBeenCalled();
    expect(net.transport).not.toHaveBeenCalled();
    expect(await fail(fetchPage("http://ricette.example.com/", net))).toBe("not_https");
    expect(await fail(fetchPage("https://127.0.0.1/", net))).toBe("blocked_host");
    expect(await fail(fetchPage("https://u:p@ricette.example.com/", net))).toBe("credentials");
  });
});

describe("fetchPage: controllo dell'indirizzo risolto", () => {
  const cases: [string, string][] = [
    ["IPv4 loopback", "127.0.0.1"],
    ["IPv4 privato 10/8", "10.1.2.3"],
    ["IPv4 privato 192.168/16", "192.168.1.10"],
    ["IPv4 privato 172.16/12", "172.20.0.5"],
    ["metadati cloud", "169.254.169.254"],
    ["CGNAT", "100.64.0.9"],
    ["non specificato", "0.0.0.0"],
    ["IPv6 loopback", "::1"],
    ["IPv6 unique local", "fd00::1234"],
    ["IPv6 link-local", "fe80::1"],
    ["IPv4 mappato", "::ffff:127.0.0.1"],
    ["IPv4 mappato in esadecimale", "::ffff:a00:1"],
    ["NAT64", "64:ff9b::7f00:1"],
  ];
  for (const [label, address] of cases) {
    it(`rifiuta un nome che si risolve in ${label}`, async () => {
      const family = address.includes(":") ? 6 : 4;
      const net = fakeNet({ [HOST]: [{ address, family }] }, { [URL1]: {} });
      expect(await fail(ok(net))).toBe("blocked_address");
      expect(net.transport).not.toHaveBeenCalled();
    });
  }

  it("rifiuta se anche un solo indirizzo risolto non è pubblico", async () => {
    const net = fakeNet({ [HOST]: [PUBLIC_V4, { address: "10.0.0.1", family: 4 }] }, { [URL1]: {} });
    expect(await fail(ok(net))).toBe("blocked_address");
    const net2 = fakeNet({ [HOST]: [{ address: "2606:4700::1111", family: 6 }, { address: "::1", family: 6 }] }, { [URL1]: {} });
    expect(await fail(ok(net2))).toBe("blocked_address");
    expect(net.transport).not.toHaveBeenCalled();
  });

  it("rifiuta un indirizzo risolto illeggibile", async () => {
    const net = fakeNet({ [HOST]: [{ address: "non-un-ip", family: 4 }] }, { [URL1]: {} });
    expect(await fail(ok(net))).toBe("blocked_address");
  });

  it("risoluzione fallita o vuota: dns_failed, senza dettagli", async () => {
    expect(await fail(ok(fakeNet({}, {})))).toBe("dns_failed");
    expect(await fail(ok(fakeNet({ [HOST]: [] }, {})))).toBe("dns_failed");
    const r = await ok(fakeNet({ [HOST]: new Error("getaddrinfo ECONNREFUSED 10.9.9.9:53") }, {}));
    expect(JSON.stringify(r)).not.toMatch(/10\.9\.9\.9|getaddrinfo/);
  });
});

describe("fetchPage: reindirizzamenti non seguiti da soli", () => {
  const redirect = (to: string, status = 302) => ({ status, headers: { location: to } });

  it("segue fino a tre salti, ricontrollando ciascuno", async () => {
    const net = fakeNet(
      { [HOST]: [PUBLIC_V4], "b.example.com": [PUBLIC_V4], "c.example.com": [PUBLIC_V4], "d.example.com": [PUBLIC_V4] },
      {
        [URL1]: redirect("https://b.example.com/uno", 301),
        "https://b.example.com/uno": redirect("/due", 307),
        "https://b.example.com/due": redirect("https://c.example.com/tre", 308),
        "https://c.example.com/tre": { body: chunks("fine") },
      },
    );
    const r = await ok(net);
    expect(r).toEqual({ ok: true, html: "fine", finalUrl: "https://c.example.com/tre" });
    expect(net.resolve.mock.calls.map((c) => c[0])).toEqual([HOST, "b.example.com", "b.example.com", "c.example.com"]);
    // ogni risposta di reindirizzamento è chiusa senza leggere il corpo
    expect(net.transport).toHaveBeenCalledTimes(4);
  });

  it("al quarto salto si ferma", async () => {
    const net = fakeNet(
      { [HOST]: [PUBLIC_V4] },
      {
        [URL1]: redirect("/a"),
        [`https://${HOST}/a`]: redirect("/b"),
        [`https://${HOST}/b`]: redirect("/c"),
        [`https://${HOST}/c`]: redirect("/d"),
        [`https://${HOST}/d`]: { body: chunks("troppo tardi") },
      },
    );
    expect(await fail(ok(net))).toBe("too_many_redirects");
    expect(net.transport).toHaveBeenCalledTimes(4);
  });

  it("rifiuta i salti verso http, verso nomi interni e verso indirizzi numerici", async () => {
    for (const target of ["http://ricette.example.com/x", "https://localhost/x", "https://127.0.0.1/", "https://[::1]/", "https://2130706433/", "https://u:p@ricette.example.com/", "https://ricette.example.com:9000/", "file:///etc/passwd", "javascript:alert(1)"]) {
      const net = fakeNet({ [HOST]: [PUBLIC_V4] }, { [URL1]: redirect(target) });
      expect(await fail(ok(net)), target).toBe("bad_redirect");
      expect(net.transport).toHaveBeenCalledTimes(1);
    }
  });

  it("rifiuta un salto verso un nome che si risolve in un indirizzo privato", async () => {
    const net = fakeNet(
      { [HOST]: [PUBLIC_V4], "evil.example.org": [{ address: "192.168.0.7", family: 4 }] },
      { [URL1]: redirect("https://evil.example.org/x"), "https://evil.example.org/x": { body: chunks("segreto interno") } },
    );
    expect(await fail(ok(net))).toBe("blocked_address");
    expect(net.transport).toHaveBeenCalledTimes(1);
  });

  it("senza Location o con Location illeggibile è un salto non valido; il corpo non viene letto", async () => {
    const r = response({ status: 302 });
    const net = fakeNet({ [HOST]: [PUBLIC_V4] }, { [URL1]: async () => r });
    expect(await fail(ok(net))).toBe("bad_redirect");
    expect(r.closed()).toBe(true);
    const net2 = fakeNet({ [HOST]: [PUBLIC_V4] }, { [URL1]: redirect("https://") });
    expect(await fail(ok(net2))).toBe("bad_redirect");
  });

  it("il limite di salti è configurabile", async () => {
    const net = fakeNet({ [HOST]: [PUBLIC_V4] }, { [URL1]: redirect("/a"), [`https://${HOST}/a`]: { body: chunks("x") } });
    expect(await fail(fetchPage(URL1, net, { maxRedirects: 0 }))).toBe("too_many_redirects");
    expect(await fail(fetchPage(URL1, net, { maxRedirects: 1 }))).toBe("ok");
  });
});

describe("fetchPage: risposta, tipo e dimensione", () => {
  it("accetta solo risposte 2xx", async () => {
    for (const status of [199, 304, 400, 403, 404, 429, 500, 503]) {
      const net = fakeNet({ [HOST]: [PUBLIC_V4] }, { [URL1]: { status } });
      expect(await fail(ok(net)), String(status)).toBe("upstream_status");
    }
  });

  it("accetta solo contenuti HTML", async () => {
    for (const ct of ["application/json", "application/pdf", "image/png", "text/plain", "application/octet-stream", "text/xml", ""]) {
      const net = fakeNet({ [HOST]: [PUBLIC_V4] }, { [URL1]: { headers: { "content-type": ct } } });
      expect(await fail(ok(net)), ct).toBe("not_html");
    }
    for (const ct of ["text/html", "TEXT/HTML; charset=UTF-8", "application/xhtml+xml"]) {
      const net = fakeNet({ [HOST]: [PUBLIC_V4] }, { [URL1]: { headers: { "content-type": ct } } });
      expect(await fail(ok(net)), ct).toBe("ok");
    }
    const noType = response();
    delete (noType.headers as Record<string, string>)["content-type"];
    expect(await fail(ok(fakeNet({ [HOST]: [PUBLIC_V4] }, { [URL1]: async () => noType })))).toBe("not_html");
  });

  it("rifiuta subito se la dimensione dichiarata supera il massimo, senza leggere", async () => {
    let read = false;
    async function* body() {
      read = true;
      yield enc("x");
    }
    const net = fakeNet({ [HOST]: [PUBLIC_V4] }, { [URL1]: { headers: { "content-length": "5000" }, body: body() } });
    expect(await fail(fetchPage(URL1, net, { maxBytes: 1000 }))).toBe("too_large");
    expect(read).toBe(false);
  });

  it("legge a flusso e si ferma al superamento del massimo, anche senza dimensione dichiarata", async () => {
    let produced = 0;
    let finished = false;
    async function* endless() {
      try {
        for (;;) {
          produced++;
          yield enc("x".repeat(400));
        }
      } finally {
        finished = true;
      }
    }
    const net = fakeNet({ [HOST]: [PUBLIC_V4] }, { [URL1]: { body: endless() } });
    expect(await fail(fetchPage(URL1, net, { maxBytes: 1000 }))).toBe("too_large");
    expect(produced).toBe(3);
    expect(finished).toBe(true);
  });

  it("il valore al limite esatto passa; un byte in più no", async () => {
    const net = (n: number) => fakeNet({ [HOST]: [PUBLIC_V4] }, { [URL1]: { body: chunks("a".repeat(n)) } });
    expect(await fail(fetchPage(URL1, net(1000), { maxBytes: 1000 }))).toBe("ok");
    expect(await fail(fetchPage(URL1, net(1001), { maxBytes: 1000 }))).toBe("too_large");
  });
});

describe("fetchPage: tempo massimo", () => {
  const never = () => new Promise<never>(() => undefined);

  it("scade se la connessione non risponde", async () => {
    const net = fakeNet({ [HOST]: [PUBLIC_V4] }, { [URL1]: never });
    expect(await fail(fetchPage(URL1, net, { timeoutMs: 30 }))).toBe("timeout");
  });

  it("scade se la risoluzione del nome non risponde", async () => {
    const net = fakeNet({}, {});
    net.resolve.mockImplementation(never);
    expect(await fail(fetchPage(URL1, net, { timeoutMs: 30 }))).toBe("timeout");
    expect(net.transport).not.toHaveBeenCalled();
  });

  it("scade se il corpo arriva a goccia", async () => {
    let closed = false;
    async function* slow() {
      yield enc("<html>");
      await never();
    }
    const net = fakeNet({ [HOST]: [PUBLIC_V4] }, { [URL1]: async () => ({ ...response({ body: slow() }), close: () => (closed = true) as unknown as void }) });
    expect(await fail(fetchPage(URL1, net, { timeoutMs: 30 }))).toBe("timeout");
    expect(closed).toBe(true);
  });

  it("il tempo vale per tutti i salti insieme", async () => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const net = fakeNet(
      { [HOST]: [PUBLIC_V4] },
      {
        [URL1]: async () => {
          await wait(25);
          return response({ status: 302, headers: { location: "/a" } });
        },
        [`https://${HOST}/a`]: async () => {
          await wait(25);
          return response({ status: 302, headers: { location: "/b" } });
        },
        [`https://${HOST}/b`]: async () => {
          await wait(60);
          return response();
        },
      },
    );
    expect(await fail(fetchPage(URL1, net, { timeoutMs: 80 }))).toBe("timeout");
  });

  it("passa il segnale di annullamento al trasporto", async () => {
    let signal: AbortSignal | undefined;
    const net = fakeNet({ [HOST]: [PUBLIC_V4] }, {
      [URL1]: async (req) => {
        signal = req.signal;
        return never();
      },
    });
    await fetchPage(URL1, net, { timeoutMs: 20 });
    expect(signal?.aborted).toBe(true);
  });
});

describe("fetchPage: errori di rete", () => {
  it("un errore del trasporto è 'network', senza dettagli", async () => {
    const net = fakeNet({ [HOST]: [PUBLIC_V4] }, {
      [URL1]: async () => {
        throw new Error("connect ECONNREFUSED 93.184.216.34:443");
      },
    });
    const r = await ok(net);
    expect(r).toEqual({ ok: false, code: "network" });
  });

  it("una codifica non gestita e un errore durante la lettura", async () => {
    const net = fakeNet({ [HOST]: [PUBLIC_V4] }, {
      [URL1]: async () => {
        throw new UnsupportedEncodingError("zstd");
      },
    });
    expect(await fail(ok(net))).toBe("unsupported_encoding");
    async function* broken() {
      yield enc("<html>");
      throw new Error("socket hang up");
    }
    const net2 = fakeNet({ [HOST]: [PUBLIC_V4] }, { [URL1]: { body: broken() } });
    expect(await fail(ok(net2))).toBe("network");
  });

  it("non lancia mai, qualunque sia l'input", async () => {
    const net = fakeNet({}, {});
    for (const u of [undefined, null, 1, {}, "", "\u0000", "https://" + "a".repeat(5000)]) {
      await expect(fetchPage(u as unknown as string, net)).resolves.toMatchObject({ ok: false });
    }
  });

  it("non scrive nulla nei log", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const net = fakeNet({ [HOST]: [PUBLIC_V4] }, { [URL1]: {} });
    await ok(net);
    await fetchPage("https://localhost/", net);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    spies.forEach((s) => s.mockRestore());
  });
});
