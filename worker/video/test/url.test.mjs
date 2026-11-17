import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALLOWED_DOMAINS, hostAllowed, validateVideoUrl } from "../src/url.mjs";

const ok = (u) => validateVideoUrl(u);

describe("validateVideoUrl", () => {
  it("accetta i domini dell'elenco e i loro sottodomini, solo https", () => {
    for (const u of [
      "https://www.instagram.com/reel/Cabc123/",
      "https://instagram.com/p/abc/?igsh=xyz",
      "https://vm.tiktok.com/ZMabc/",
      "https://www.tiktok.com/@utente/video/123",
      "https://www.youtube.com/watch?v=abc",
      "https://m.youtube.com/shorts/abc",
      "https://youtu.be/abc",
      "https://YOUTU.BE/abc",
      "https://www.youtube.com./watch?v=abc",
    ]) {
      const r = ok(u);
      assert.equal(r.ok, true, u);
    }
  });

  it("toglie il frammento e normalizza l'indirizzo", () => {
    const r = ok("https://youtu.be/abc#t=10");
    assert.deepEqual(r, { ok: true, url: "https://youtu.be/abc", host: "youtu.be" });
  });

  it("rifiuta tutto ciò che non è https", () => {
    for (const u of ["http://www.instagram.com/reel/x", "ftp://instagram.com/x", "javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "//instagram.com/x", "instagram.com/x"]) {
      assert.equal(ok(u).ok, false, u);
    }
  });

  it("non si lascia ingannare da domini simili o da trucchi nell'indirizzo", () => {
    const cases = [
      "https://instagram.com.evil.example/reel/x",
      "https://evil-instagram.com/x",
      "https://notyoutube.com/x",
      "https://youtube.com.evil.example/",
      "https://evil.example/instagram.com",
      "https://evil.example/?u=https://www.instagram.com/x",
      "https://evil.example#@instagram.com",
      "https://youtu.be.evil.example/abc",
      "https://xn--instgram-ncb.com/x",
      "https://instagram.co/x",
      "https://instagram.com.cn/x",
    ];
    for (const u of cases) {
      const r = ok(u);
      assert.equal(r.ok, false, u);
    }
  });

  it("rifiuta credenziali, porte, backslash, spazi e caratteri di controllo", () => {
    for (const u of [
      "https://instagram.com@evil.example/x",
      "https://utente:password@www.instagram.com/x",
      "https://www.instagram.com:8443/x",
      "https://www.instagram.com:80/x",
      "https://evil.example\\@www.instagram.com/x",
      "https://www.instagram.com/x y",
      "https://www.instagram.com/x\u0000",
      "https://www.instagram.com/\nx",
      "https://www.instagram.com/\tx",
    ]) {
      assert.equal(ok(u).ok, false, JSON.stringify(u));
    }
    // la porta 443 esplicita è quella di https
    assert.equal(ok("https://www.instagram.com:443/x").ok, true);
  });

  it("rifiuta indirizzi numerici e IPv6", () => {
    for (const u of ["https://127.0.0.1/", "https://169.254.169.254/latest/meta-data", "https://[::1]/", "https://2130706433/", "https://localhost/"]) {
      assert.equal(ok(u).ok, false, u);
    }
  });

  it("rifiuta ciò che non è una stringa o è troppo lungo", () => {
    for (const v of [undefined, null, 42, {}, [], ["https://youtu.be/a"], ""]) {
      assert.deepEqual(validateVideoUrl(v), { ok: false, code: "invalid_url" });
    }
    assert.equal(ok(`https://www.youtube.com/watch?v=${"a".repeat(3000)}`).ok, false);
  });

  it("distingue indirizzo non valido da dominio non ammesso", () => {
    assert.deepEqual(validateVideoUrl("https://esempio.it/x"), { ok: false, code: "domain_not_allowed" });
    assert.deepEqual(validateVideoUrl("non un indirizzo"), { ok: false, code: "invalid_url" });
  });
});

describe("hostAllowed", () => {
  it("confronta l'host, non la stringa", () => {
    assert.equal(hostAllowed("instagram.com"), true);
    assert.equal(hostAllowed("a.b.instagram.com"), true);
    assert.equal(hostAllowed("Instagram.COM."), true);
    assert.equal(hostAllowed("xinstagram.com"), false);
    assert.equal(hostAllowed("instagram.com.evil.it"), false);
    assert.equal(hostAllowed(""), false);
    assert.equal(hostAllowed("com"), false);
  });
  it("l'elenco è quello previsto", () => {
    assert.deepEqual([...ALLOWED_DOMAINS], ["instagram.com", "tiktok.com", "youtube.com", "youtu.be"]);
    assert.equal(Object.isFrozen(ALLOWED_DOMAINS), true);
  });
});
