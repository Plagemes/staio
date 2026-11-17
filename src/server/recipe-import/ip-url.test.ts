import { describe, expect, it } from "vitest";
import { isPublicAddress, looksLikeIpLiteral, parseIPv4, parseIPv6 } from "./ip";
import { checkUrl } from "./url";

describe("parseIPv4", () => {
  it("legge tutte le forme di scrittura", () => {
    expect(parseIPv4("127.0.0.1")).toEqual([127, 0, 0, 1]);
    expect(parseIPv4("127.1")).toEqual([127, 0, 0, 1]);
    expect(parseIPv4("2130706433")).toEqual([127, 0, 0, 1]);
    expect(parseIPv4("0x7f000001")).toEqual([127, 0, 0, 1]);
    expect(parseIPv4("0x7f.0.0.1")).toEqual([127, 0, 0, 1]);
    expect(parseIPv4("0177.0.0.1")).toEqual([127, 0, 0, 1]);
    expect(parseIPv4("017700000001")).toEqual([127, 0, 0, 1]);
    expect(parseIPv4("10.1")).toEqual([10, 0, 0, 1]);
    expect(parseIPv4("192.168.257")).toEqual([192, 168, 1, 1]);
    expect(parseIPv4("0")).toEqual([0, 0, 0, 0]);
  });

  it("rifiuta ciò che non è un IPv4", () => {
    for (const s of ["", "1.2.3.4.5", "256.1.1.1", "1.2.3.256", "4294967296", "08.0.0.1", "0x", "1..2", "a.b.c.d", "1.2.3.", " 1.2.3.4", "-1.0.0.1", "1e3"]) {
      expect(parseIPv4(s)).toBeNull();
    }
  });
});

describe("parseIPv6", () => {
  it("legge forme complete, abbreviate e con IPv4 in coda", () => {
    expect(parseIPv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6("[::1]")).toEqual(parseIPv6("0:0:0:0:0:0:0:1"));
    expect(parseIPv6("::ffff:127.0.0.1")).toEqual(parseIPv6("0:0:0:0:0:ffff:7f00:1"));
    expect(parseIPv6("2001:db8::")).toHaveLength(16);
    expect(parseIPv6("::")).toEqual(new Array(16).fill(0));
  });

  it("rifiuta le forme non valide e gli identificatori di zona", () => {
    for (const s of ["", "1", ":::", "1::2::3", "fe80::1%eth0", "12345::1", "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7", "::ffff:1.2.3", "::ffff:256.1.1.1", "::ffff:01.2.3.4", "g::1"]) {
      expect(parseIPv6(s)).toBeNull();
    }
  });
});

describe("isPublicAddress", () => {
  it("accetta gli indirizzi pubblici", () => {
    for (const a of ["8.8.8.8", "93.184.216.34", "1.1.1.1", "172.15.255.255", "172.32.0.1", "11.0.0.1", "100.63.255.255", "100.128.0.1", "198.17.0.1", "198.20.0.1", "2606:4700:4700::1111", "2a00:1450:4001:81b::200e", "2001:4860:4860::8888", "::ffff:8.8.8.8"]) {
      expect(isPublicAddress(a), a).toBe(true);
    }
  });

  it("rifiuta IPv4 privati, locali e riservati", () => {
    for (const a of [
      "0.0.0.0", "0.1.2.3", "10.0.0.1", "10.255.255.255", "100.64.0.1", "100.127.255.255", "127.0.0.1", "127.255.255.254",
      "169.254.169.254", "169.254.0.1", "172.16.0.1", "172.31.255.255", "192.0.0.1", "192.0.2.5", "192.88.99.1",
      "192.168.1.1", "198.18.0.1", "198.19.255.255", "198.51.100.7", "203.0.113.9", "224.0.0.1", "239.255.255.255",
      "240.0.0.1", "255.255.255.255",
    ]) {
      expect(isPublicAddress(a), a).toBe(false);
    }
  });

  it("rifiuta le forme alternative di scrittura IPv4", () => {
    for (const a of ["127.1", "2130706433", "0x7f000001", "0x7f.1", "0177.0.0.1", "017700000001", "10.1", "0xa9fea9fe", "2852039166", "3232235777", "0300.0250.0.1", "0"]) {
      expect(isPublicAddress(a), a).toBe(false);
    }
  });

  it("rifiuta IPv6 locali, privati, riservati e di transizione", () => {
    for (const a of [
      "::", "::1", "0:0:0:0:0:0:0:1", "fe80::1", "fe80::1234:5678", "febf::1", "fc00::1", "fd12:3456:789a::1", "fec0::1", "ff02::1",
      "2001::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "2001:2::1", "2001:10::1", "2001:db8::1", "2002:7f00:1::1", "2002:c0a8:101::1",
      "64:ff9b::7f00:1", "64:ff9b::8.8.8.8", "100::1", "3fff::1", "::127.0.0.1", "::8.8.8.8", "[::1]",
    ]) {
      expect(isPublicAddress(a), a).toBe(false);
    }
  });

  it("per gli IPv6 mappati vale l'indirizzo IPv4 incorporato, in ogni scrittura", () => {
    for (const a of ["::ffff:127.0.0.1", "::ffff:7f00:1", "0:0:0:0:0:ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:a00:1", "::ffff:169.254.169.254", "::FFFF:C0A8:0101", "0000:0000:0000:0000:0000:ffff:7f00:0001"]) {
      expect(isPublicAddress(a), a).toBe(false);
    }
    expect(isPublicAddress("::ffff:808:808")).toBe(true);
  });

  it("ciò che non si legge non è pubblico", () => {
    for (const a of ["", "ciao", "example.com", "1.2.3.", "fe80::1%eth0", "::ffff:", "1.2.3.4/8", "8.8.8.8 ", "8.8.8.8\n", "999.1.1.1", "\u0000"]) {
      expect(isPublicAddress(a), JSON.stringify(a)).toBe(false);
    }
  });
});

describe("looksLikeIpLiteral", () => {
  it("riconosce gli indirizzi numerici in ogni forma", () => {
    for (const h of ["127.0.0.1", "127.1", "2130706433", "0x7f.1", "[::1]", "::1", "foo.123", "foo.0x7f", "1.2.3.4"]) {
      expect(looksLikeIpLiteral(h), h).toBe(true);
    }
    for (const h of ["example.com", "a.b.it", "3m.com", "xn--caff-8qa.it"]) expect(looksLikeIpLiteral(h), h).toBe(false);
  });
});

describe("checkUrl", () => {
  it("accetta un indirizzo https pubblico e toglie il frammento", () => {
    const r = checkUrl("https://www.ricette.example.com/pasta?id=3#note");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.url.toString()).toBe("https://www.ricette.example.com/pasta?id=3");
    expect(r.hostname).toBe("www.ricette.example.com");
    expect(checkUrl("  HTTPS://Ricette.IT:443/x ").ok).toBe(true);
    expect(checkUrl("https://caffè.it/").ok).toBe(true);
    expect(checkUrl("https://example.com./x").ok).toBe(true);
  });

  const code = (u: unknown) => {
    const r = checkUrl(u);
    return r.ok ? "ok" : r.code;
  };

  it("accetta solo https", () => {
    for (const u of ["http://example.com/", "ftp://example.com/", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,<p>x", "gopher://example.com", "ws://example.com", "HTTP://example.com"]) {
      expect(code(u), u).toBe("not_https");
    }
    for (const u of ["example.com", "//example.com/x", "", "   ", "https://", "https://exa mple.com/", "not a url", 12, null, undefined, {}, "https://example.com/\u0000"]) {
      expect(code(u), String(u)).toBe("invalid_url");
    }
    expect(code("https://" + "a".repeat(2100) + ".com/")).toBe("invalid_url");
  });

  it("rifiuta credenziali nell'indirizzo e porte diverse da 443", () => {
    expect(code("https://utente:segreto@example.com/")).toBe("credentials");
    expect(code("https://utente@example.com/")).toBe("credentials");
    expect(code("https://example.com:8443/")).toBe("bad_port");
    expect(code("https://example.com:22/")).toBe("bad_port");
    expect(code("https://example.com:443/")).toBe("ok");
  });

  it("rifiuta i nomi locali, interni e riservati", () => {
    for (const u of [
      "https://localhost/", "https://LOCALHOST/", "https://localhost./", "https://foo.localhost/", "https://intranet/",
      "https://server/", "https://printer.local/", "https://nas.lan/", "https://host.home.arpa/", "https://metadata.google.internal/",
      "https://app.internal/", "https://router.home/", "https://x.corp/", "https://foo.test/", "https://foo.invalid/", "https://foo.example/",
      "https://abc.onion/", "https://1.0.0.127.in-addr.arpa/", "https://-x.com/", "https://a..b.com/", "https://a_b.com/",
    ]) {
      expect(code(u), u).toBe("blocked_host");
    }
  });

  it("rifiuta gli indirizzi numerici in ogni forma, IPv4 e IPv6", () => {
    for (const u of [
      "https://127.0.0.1/", "https://127.1/", "https://2130706433/", "https://0x7f000001/", "https://0x7f.0.0.1/", "https://0177.0.0.1/",
      "https://017700000001/", "https://10.0.0.1/", "https://169.254.169.254/latest/meta-data/", "https://192.168.0.1/", "https://172.16.5.4/",
      "https://[::1]/", "https://[0:0:0:0:0:0:0:1]/", "https://[::ffff:127.0.0.1]/", "https://[::ffff:7f00:1]/", "https://[fe80::1]/",
      "https://[fc00::1]/", "https://[2001:db8::1]/", "https://8.8.8.8/", "https://[2606:4700:4700::1111]/", "https://1.2.3.4./", "https:///x",

    ]) {
      expect(code(u), u).toBe("blocked_host");
    }
  });
});
