import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../src/config.mjs";
import { cleanStaleDirs, extractVideo } from "../src/extract.mjs";
import { ServiceError } from "../src/limits.mjs";
import { verifyRedirectChain } from "../src/redirects.mjs";
import { childEnv, ffmpegFrameArgs, ytdlpDownloadArgs, ytdlpInfoArgs } from "../src/tools.mjs";

const URL_OK = "https://www.instagram.com/reel/abc/";
let root;
let cfg;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "staio-video-test-"));
  cfg = loadConfig({ STAIO_VIDEO_TOKEN: "t".repeat(32), STAIO_VIDEO_TMP: root, STAIO_VIDEO_FRAMES: "3" });
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

const noRedirect = async () => new Response("<html></html>", { status: 200 });
const redirectTo = (map) => async (url) => {
  const next = map[url];
  return next ? new Response(null, { status: 302, headers: { location: next } }) : new Response("", { status: 200 });
};
const info = { extractor_key: "Instagram", webpage_url: URL_OK, duration: 30, description: "Pasta al limone" };

/** Finto yt-dlp / ffmpeg: nessun processo vero. */
function fakeRun({ infoJson = info, failOn } = {}) {
  const calls = [];
  const run = async (file, args, { dir }) => {
    calls.push({ file, args, dir });
    if (failOn === file) throw new ServiceError("unavailable", 502);
    if (args.includes("--dump-single-json")) return JSON.stringify(infoJson);
    if (args.includes("--max-filesize")) {
      await writeFile(join(dir, "video.mp4"), Buffer.alloc(1000));
      return "";
    }
    // fotogramma: l'ultimo argomento è il file di uscita
    await writeFile(args[args.length - 1], Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]));
    return "";
  };
  return { run, calls };
}

describe("reindirizzamenti", () => {
  it("senza reindirizzamenti passa", async () => {
    assert.deepEqual(await verifyRedirectChain(URL_OK, { fetch: noRedirect }), [URL_OK]);
  });
  it("li segue finché restano nei domini ammessi", async () => {
    const chain = await verifyRedirectChain("https://vm.tiktok.com/ZM1/", {
      fetch: redirectTo({ "https://vm.tiktok.com/ZM1/": "https://www.tiktok.com/@u/video/1" }),
    });
    assert.equal(chain.length, 2);
  });
  it("si ferma se un passaggio esce dall'elenco, anche con indirizzi relativi o http", async () => {
    for (const target of ["https://evil.example/x", "http://www.instagram.com/x", "https://instagram.com.evil.example/x", "https://127.0.0.1/x", "ftp://instagram.com/x"]) {
      await assert.rejects(verifyRedirectChain(URL_OK, { fetch: redirectTo({ [URL_OK]: target }) }), (e) => e instanceof ServiceError && e.code === "domain_not_allowed", target);
    }
  });
  it("non accetta catene troppo lunghe né cicli infiniti", async () => {
    await assert.rejects(verifyRedirectChain(URL_OK, { fetch: async () => new Response(null, { status: 302, headers: { location: URL_OK } }) }), (e) => e instanceof ServiceError);
  });
  it("non segue mai i reindirizzamenti da solo", async () => {
    let seen;
    await verifyRedirectChain(URL_OK, { fetch: async (_u, init) => ((seen = init), new Response("", { status: 200 })) });
    assert.equal(seen.redirect, "manual");
  });
});

describe("argomenti degli strumenti", () => {
  it("l'indirizzo sta dopo «--» e gli argomenti sono un array", () => {
    for (const args of [ytdlpInfoArgs(URL_OK), ytdlpDownloadArgs(URL_OK, "/tmp/x", 1000)]) {
      assert.ok(Array.isArray(args));
      assert.equal(args.at(-1), URL_OK);
      assert.equal(args.at(-2), "--");
      assert.ok(args.includes("--no-playlist"));
      assert.ok(args.includes("--ignore-config"));
    }
    assert.ok(ytdlpDownloadArgs(URL_OK, "/tmp/x", 1000).includes("--max-filesize"));
  });
  it("un indirizzo ostile resta un solo argomento", () => {
    const hostile = "https://www.youtube.com/watch?v=a;rm -rf /&&$(id)`id`";
    const args = ytdlpInfoArgs(hostile);
    assert.equal(args.filter((a) => a === hostile).length, 1);
  });
  it("il fotogramma ha un solo istante e una sola uscita", () => {
    const args = ffmpegFrameArgs("/tmp/v.mp4", "/tmp/f.jpg", 12.345, 768);
    assert.deepEqual(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 2), ["-ss", "12.35"]);
    assert.equal(args.at(-1), "/tmp/f.jpg");
    assert.ok(args.includes("-nostdin"));
  });
  it("i processi figli non ricevono il token né il resto dell'ambiente", () => {
    process.env.STAIO_VIDEO_TOKEN = "segretissimo-segretissimo-1234";
    const env = childEnv("/tmp/req-1");
    assert.deepEqual(Object.keys(env).sort(), ["HOME", "LANG", "PATH", "TMPDIR"]);
    assert.ok(!JSON.stringify(env).includes("segretissimo"));
    delete process.env.STAIO_VIDEO_TOKEN;
  });
});

describe("estrazione", () => {
  it("restituisce didascalia, fotogrammi e durata, e cancella la cartella", async () => {
    const { run } = fakeRun();
    const result = await extractVideo(URL_OK, cfg, { run, fetch: noRedirect });
    assert.equal(result.caption, "Pasta al limone");
    assert.equal(result.frames.length, 3);
    assert.equal(result.durationSec, 30);
    assert.equal("transcript" in result, false);
    assert.deepEqual(readdirSync(root), []);
  });

  it("usa la trascrizione se il punto di estensione la fornisce, e ignora i suoi errori", async () => {
    const { run } = fakeRun();
    const withText = await extractVideo(URL_OK, cfg, { run, fetch: noRedirect, transcribe: async () => "parlato trascritto" });
    assert.equal(withText.transcript, "parlato trascritto");
    const broken = await extractVideo(URL_OK, cfg, {
      run: fakeRun().run,
      fetch: noRedirect,
      transcribe: async () => {
        throw new Error("boom");
      },
    });
    assert.equal("transcript" in broken, false);
  });

  it("cancella la cartella anche in caso di errore, e non scarica video lunghi", async () => {
    const long = fakeRun({ infoJson: { ...info, duration: 900 } });
    await assert.rejects(extractVideo(URL_OK, cfg, { run: long.run, fetch: noRedirect }), (e) => e.code === "too_long");
    assert.ok(!long.calls.some((c) => c.args.includes("--max-filesize")), "non deve scaricare");
    assert.deepEqual(readdirSync(root), []);

    const failing = fakeRun({ failOn: cfg.ytdlp });
    await assert.rejects(extractVideo(URL_OK, cfg, { run: failing.run, fetch: noRedirect }), (e) => e.code === "unavailable");
    assert.deepEqual(readdirSync(root), []);
  });

  it("rifiuta un reindirizzamento fuori elenco prima di chiamare yt-dlp", async () => {
    const { run, calls } = fakeRun();
    await assert.rejects(
      extractVideo(URL_OK, cfg, { run, fetch: redirectTo({ [URL_OK]: "https://evil.example/v" }) }),
      (e) => e.code === "domain_not_allowed",
    );
    assert.equal(calls.length, 0);
    assert.deepEqual(readdirSync(root), []);
  });

  it("rifiuta una pagina finale fuori elenco indicata dai metadati", async () => {
    const { run } = fakeRun({ infoJson: { ...info, webpage_url: "https://evil.example/v" } });
    await assert.rejects(extractVideo(URL_OK, cfg, { run, fetch: noRedirect }), (e) => e.code === "domain_not_allowed");
  });

  it("un fotogramma che non si estrae non fa fallire la richiesta", async () => {
    let n = 0;
    const base = fakeRun().run;
    const run = async (file, args, o) => {
      if (args.includes("-frames:v") && n++ === 0) throw new ServiceError("unavailable", 502);
      return base(file, args, o);
    };
    const result = await extractVideo(URL_OK, cfg, { run, fetch: noRedirect });
    assert.equal(result.frames.length, 2);
  });

  it("all'avvio toglie solo le cartelle lasciate da richieste interrotte", async () => {
    await mkdir(join(root, "req-vecchia"), { recursive: true });
    await writeFile(join(root, "req-vecchia", "video.mp4"), "x");
    await writeFile(join(root, "altro.txt"), "non toccare");
    assert.equal(await cleanStaleDirs(root), 1);
    assert.equal(existsSync(join(root, "req-vecchia")), false);
    assert.equal(existsSync(join(root, "altro.txt")), true);
    await rm(join(root, "altro.txt"));
  });
});
