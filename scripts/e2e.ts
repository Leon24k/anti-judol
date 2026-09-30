/**
 * End-to-end smoke test in a real Chrome with the built extension loaded.
 *
 *   bun run e2e                 # local-only mode checks
 *   TS_KEY=apikey_… bun run e2e # + live Jev checks (key is passed via env, never written to disk)
 *
 * YouTube-shaped fixture pages are served at real https://www.youtube.com/… URLs through request
 * interception, so the content script injects exactly as in production, but results are deterministic.
 * A hard watchdog kills Chrome if anything hangs.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

const CHROME =
  process.env.CHROME_BIN ??
  (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
const TS_KEY = process.env.TS_KEY ?? "";
const HEADLESS = process.env.HEADFUL ? false : true;
const DIST = resolve("dist");
// Chrome's permission prompt can't be clicked by automation, so the E2E build pre-grants the
// optional platform hosts. Everything else (settings → dynamic registration → injection) is real.
const E2E_DIST = join(tmpdir(), `aj-e2e-dist-${process.pid}`);
const X_URL = "https://x.com/someone/status/1";
const PAGE = "https://www.youtube.com/watch?v=e2etest";

const JUDOL = [
  "s l o t g4c0r hari ini, cek bio 🔥",
  "𝐉𝐔𝐃𝐈𝟖𝟖𝟖 maxwiiiin wd 10rb",
  "kasino310 (dot) com depo 10rb langsung jp",
];
const SAFE = ["Mantap videonya bang, lanjutkan!", "Berita: polisi tangkap bandar judi online, semoga diberantas", "Parkir slot mobil di mall penuh terus"];
const SUBTLE = "Cuma modal receh bisa jadi jutaan, cek profil aku ya kak"; // no hard keywords → needs Jev

const comment = (t: string, i: number) =>
  `<ytd-comment-view-model data-i="${i}"><span id="author-text">@user${i}</span><span id="content-text">${t}</span></ytd-comment-view-model>`;
const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>E2E</title>
<style>body{font:14px Arial;width:720px} ytd-comment-view-model{display:block;padding:10px;margin:6px;border:1px solid #ddd}</style></head>
<body><h1>Fixture video</h1><iframe id="chat" src="https://www.youtube.com/live_chat?v=e2etest" width="400" height="120"></iframe>
<div id="comments">${[...JUDOL, ...SAFE, SUBTLE].map(comment).join("")}</div>
<script>
window.addComment = (t) => new Promise((res) => {
  const d = document.createElement("div"); d.innerHTML = ${JSON.stringify(comment("__T__", 99))}.replace("__T__", t);
  const el = d.firstElementChild; const t0 = performance.now();
  document.getElementById("comments").append(el);
  requestAnimationFrame(() => res({ state: el.getAttribute("data-aj-state"), ms: performance.now() - t0 }));
});
</script></body></html>`;
const CHAT = `<!doctype html><html><body>
<yt-live-chat-text-message-renderer><span id="author-name">SLOT88 RESMI</span><span id="message">gacor maxwin wd cepat klik bio</span></yt-live-chat-text-message-renderer>
<yt-live-chat-text-message-renderer><span id="author-name">viewer</span><span id="message">halo semua dari Surabaya</span></yt-live-chat-text-message-renderer>
</body></html>`;

// ---------- harness ----------
let failed = 0;
const results: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failed++;
  results.push(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  console.log(results.at(-1));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let browser: Browser | undefined;
const profile = await mkdtemp(join(tmpdir(), "aj-e2e-"));
const watchdog = setTimeout(async () => {
  console.error("✗ watchdog: e2e exceeded 120s, killing Chrome");
  browser?.process()?.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
  process.exit(2);
}, 120_000);

const NEWS_URL = "https://berita-e2e.example/artikel";
const NEWS_FIXTURE = `<!doctype html><html><head><title>Harga cabai naik jelang Lebaran</title></head><body>
<h1>Harga cabai naik jelang Lebaran</h1><p>Harga cabai rawit di pasar naik 20% minggu ini. <a href="/lain">Berita lain</a></p>
<div id="ad1"><a href="https://agenslots77.com/daftar"><img src="https://cdn-e2e.example/b.gif" width="300" height="100"></a></div>
<div id="ad2"><img src="/banner-slot-gacor-maxwin.gif" width="300" height="100"></div>
<p id="seo">Link: <a href="https://spam-e2e.example/">SLOT GACOR HARI INI MAXWIN</a></p>
<img id="photo" src="/foto-pasar.jpg" alt="Pasar tradisional" width="300" height="100">
</body></html>`;
const HACKED_URL = "https://kampus-e2e.example/wp-content/slot/";
const HACKED_FIXTURE = `<!doctype html><html><head><title>SLOT GACOR MAXWIN Hari Ini - Situs Slot Online Terpercaya</title></head>
<body><h1>Situs slot gacor terpercaya</h1></body></html>`;
const X_FIXTURE = `<!doctype html><html><body>
<article data-testid="tweet"><div data-testid="User-Name"><span>SLOT88</span></div><div data-testid="tweetText">s l o t g4c0r maxwin depo 10rb cek bio</div></article>
<article data-testid="tweet"><div data-testid="User-Name"><span>Budi</span></div><div data-testid="tweetText">Pagi semua, macet parah di Sudirman</div></article>
</body></html>`;

async function serve(page: Page): Promise<void> {
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const u = r.url();
    if (u.startsWith("https://x.com/")) return void r.respond({ status: 200, contentType: "text/html", body: X_FIXTURE });
    if (u === NEWS_URL) return void r.respond({ status: 200, contentType: "text/html", body: NEWS_FIXTURE });
    if (u === HACKED_URL) return void r.respond({ status: 200, contentType: "text/html", body: HACKED_FIXTURE });
    if (/\.(gif|jpg|png)$/.test(new URL(u).pathname)) return void r.respond({ status: 200, contentType: "image/gif", body: "GIF89a" });
    if (u.startsWith("https://www.youtube.com/watch")) return void r.respond({ status: 200, contentType: "text/html", body: FIXTURE });
    if (u.startsWith("https://www.youtube.com/live_chat")) return void r.respond({ status: 200, contentType: "text/html", body: CHAT });
    return void r.abort();
  });
}

async function states(page: Page): Promise<Record<string, string | null>> {
  return page.$$eval("#comments ytd-comment-view-model", (els) =>
    Object.fromEntries(els.map((e) => [e.querySelector("#content-text")?.textContent ?? "", e.getAttribute("data-aj-state")])),
  );
}

try {
  await cp(DIST, E2E_DIST, { recursive: true });
  const man = JSON.parse(await readFile(join(E2E_DIST, "manifest.json"), "utf8"));
  man.host_permissions = [...man.host_permissions, ...man.optional_host_permissions];
  await writeFile(join(E2E_DIST, "manifest.json"), JSON.stringify(man));

  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: HEADLESS,
    pipe: true,
    enableExtensions: [E2E_DIST],
    userDataDir: profile,
    args: ["--no-first-run", "--no-default-browser-check", "--disable-sync"],
  });
  const sw = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("/background.js"), { timeout: 15_000 });
  const extId = new URL(sw.url()).host;
  check("extension loads in Chrome", !!extId, `id ${extId}`);

  const extErrors: string[] = [];
  const worker = await sw.worker();
  worker?.on("console", (m) => m.type() === "error" && extErrors.push(`sw: ${m.text()}`));

  // Close the auto-opened options tab from onInstalled.
  await sleep(500);
  for (const p of await browser.pages()) if (p.url().includes("options.html")) await p.close();

  // ---------- local-only mode (default: no key, no consent) ----------
  const page = await browser.newPage();
  page.on("pageerror", (e) => extErrors.push(`page: ${e}`));
  await serve(page);
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await sleep(800);

  let st = await states(page);
  check("local: obfuscated judol comments blurred", JUDOL.every((t) => st[t] === "judol"), JSON.stringify(JUDOL.map((t) => st[t])));
  check("local: safe comments untouched", SAFE.every((t) => st[t] === null), JSON.stringify(SAFE.map((t) => st[t])));

  const blurred = await page.$eval("ytd-comment-view-model[data-aj-state] #content-text", (e) => getComputedStyle(e).filter);
  check("blur applied by CSS", blurred.includes("blur"), blurred);

  const dyn = await page.evaluate(() => (window as unknown as { addComment(t: string): Promise<{ state: string | null; ms: number }> }).addComment("ｓｌｏｔ ｇａｃｏｒ maxwin depo 10rb"));
  check("dynamic comment blurred before next frame", dyn.state === "judol", `${dyn.ms.toFixed(1)}ms to rAF, state=${dyn.state}`);

  const chat = await page.frames().find((f) => f.url().includes("live_chat"))!;
  const chatStates = await chat.$$eval("yt-live-chat-text-message-renderer", (els) => els.map((e) => e.getAttribute("data-aj-state")));
  check("live chat iframe scanned (all_frames)", chatStates[0] === "judol" && chatStates[1] === null, JSON.stringify(chatStates));

  const noNetwork = await page.evaluate(() => performance.getEntriesByType("resource").filter((r) => /typesafe|openrouter/.test(r.name)).length);
  check("no API traffic from page context", noNetwork === 0);

  // Click-to-reveal then "Bukan judol".
  await page.click(`ytd-comment-view-model[data-i="0"] #content-text`);
  const revealed = await page.$eval(`ytd-comment-view-model[data-i="0"]`, (e) => e.hasAttribute("data-aj-revealed"));
  check("click on blurred comment reveals it", revealed);
  await page.click(`ytd-comment-view-model[data-i="0"] button[data-aj-act="allow"]`);
  await sleep(300);
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(800);
  st = await states(page);
  check("'Bukan judol' whitelist persists after reload", st[JUDOL[0]!] === null && st[JUDOL[1]!] === "judol");

  // "Laporkan": copies a ready report and opens aduankonten.id (never auto-submits).
  {
    const ctx = browser.defaultBrowserContext();
    await ctx.overridePermissions("https://www.youtube.com", ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
    const opened = new Promise<string>((res) => browser!.once("targetcreated", (t) => res(t.url())));
    await page.click(`ytd-comment-view-model[data-i="1"] button[data-aj-act="report"]`);
    const url = await Promise.race([opened, sleep(3000).then(() => "")]);
    check("'Laporkan' opens aduankonten.id", url.startsWith("https://aduankonten.id"), url);
    for (const p of await browser.pages()) if (p.url().includes("aduankonten")) await p.close();
    await page.bringToFront();
    await sleep(200);
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => `ERR ${e}`);
    check("report text copied with link + original comment", clip.includes("Kategori: Perjudian") && clip.includes("watch?v=e2etest") && clip.includes(JUDOL[1]!), clip.slice(0, 120));
    for (const p of await browser.pages()) if (p.url().includes("aduankonten")) await p.close();
  }

  // ---------- extension-page security ----------
  const opts = await browser.newPage();
  opts.on("pageerror", (e) => extErrors.push(`options: ${e}`));
  await opts.goto(`chrome-extension://${extId}/options.html`, { waitUntil: "load" });
  const send = (msg: object) => opts.evaluate((m) => chrome.runtime.sendMessage(m), msg as never) as Promise<Record<string, unknown>>;

  // Per-page toggle applies live to the open tab via broadcast.
  await send({ type: "rules:page", pageKey: "youtube.com/watch?v=e2etest", on: false });
  await sleep(500);
  st = await states(page);
  check("per-page OFF clears marks live (no reload)", Object.values(st).every((v) => v === null));
  await send({ type: "rules:page", pageKey: "youtube.com/watch?v=e2etest", on: null });
  await sleep(800);
  st = await states(page);
  check("per-page reset restores protection", st[JUDOL[1]!] === "judol");

  // No externally_connectable → YouTube's own scripts cannot message the extension.
  const exposed = await page.evaluate(() => typeof (globalThis as { chrome?: { runtime?: { sendMessage?: unknown } } }).chrome?.runtime?.sendMessage);
  check("YouTube page scripts cannot message the extension", exposed === "undefined", exposed);

  // ---------- opt-in platforms (X) ----------
  const xStates = async () => {
    const xp = await browser!.newPage();
    await serve(xp);
    await xp.goto(X_URL, { waitUntil: "domcontentloaded" });
    await sleep(800);
    const st = await xp.$$eval('article[data-testid="tweet"]', (els) => els.map((e) => e.getAttribute("data-aj-state")));
    await xp.close();
    return st;
  };
  check("X not scanned until the user enables it", (await xStates()).every((s) => s === null));
  await send({ type: "settings:update", patch: { platforms: { x: true } } });
  const regs = await worker!.evaluate(() => chrome.scripting.getRegisteredContentScripts().then((r) => r.map((x) => x.id)));
  check("enabling X registers its content script", regs.includes("aj-platform-x"), JSON.stringify(regs));
  const xs = await xStates();
  check("X: judol tweet blurred, normal tweet untouched", xs[0] === "judol" && xs[1] === null, JSON.stringify(xs));
  await send({ type: "settings:update", patch: { platforms: { x: false } } });
  const regs2 = await worker!.evaluate(() => chrome.scripting.getRegisteredContentScripts().then((r) => r.map((x) => x.id)));
  check("disabling X unregisters it", !regs2.includes("aj-platform-x"), JSON.stringify(regs2));

  // ---------- gambling-site blocking (declarativeNetRequest) ----------
  {
    const t0 = Date.now();
    let bs = (await send({ type: "block:status" })) as { activeCount: number; remoteCount: number; lastError: string | null; warningPage: boolean };
    while (bs.activeCount < 100_000 && !bs.lastError && Date.now() - t0 < 30_000) {
      await sleep(500);
      bs = (await send({ type: "block:status" })) as typeof bs;
    }
    check("community list downloaded + loaded into DNR", bs.activeCount > 100_000, `${bs.activeCount} domains, ${Date.now() - t0}ms, error=${bs.lastError}`);
    const n = await worker!.evaluate(() => chrome.declarativeNetRequest.getDynamicRules().then((r) => r.length));
    check("rules chunked within DNR limits", n > 0 && n < 200, `${n} dynamic rules`);

    const visit = async (url: string) => {
      const p = await browser!.newPage();
      await p.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => {});
      await sleep(400);
      const out = { url: p.url(), title: await p.title().catch(() => "") };
      await p.close();
      return out;
    };
    const listed = await visit("https://agenslots77.com/daftar");
    check("listed gambling domain → warning page", listed.url.includes("/blocked.html#https://agenslots77.com/daftar"), listed.url);

    await send({ type: "settings:update", patch: { blockDomains: ["aj-e2e-judi-test.com"] } });
    const custom = await visit("https://www.aj-e2e-judi-test.com/");
    check("user-added domain (and its subdomains) blocked", custom.url.includes("blocked.html"), custom.url);

    const safe = await visit("https://www.google.com/");
    check("protected domain never redirected", !safe.url.includes("blocked.html"), safe.url);

    // Warning page actions: allow permanently.
    const bp = await browser!.newPage();
    await bp.goto("https://aj-e2e-judi-test.com/", { waitUntil: "domcontentloaded" }).catch(() => {});
    await sleep(300);
    check("warning page shows the domain", (await bp.$eval("#domain", (e) => e.textContent).catch(() => "")) === "aj-e2e-judi-test.com");
    bp.on("dialog", (d) => void d.accept());
    await bp.click("details summary");
    await bp.click("#allow");
    await sleep(1200);
    await bp.close();
    const after = (await send({ type: "settings:get" })) as { settings: { allowDomains: string[] } };
    check("'Bukan situs judi' adds to allow list", after.settings.allowDomains.includes("aj-e2e-judi-test.com"));
    const again = await visit("https://aj-e2e-judi-test.com/");
    check("allowed domain no longer blocked", !again.url.includes("blocked.html"), again.url);
    await send({ type: "settings:update", patch: { blockDomains: [], allowDomains: [] } });
  }

  // ---------- all-sites scanner (opt-in) ----------
  {
    const newsMarks = async () => {
      const np = await browser!.newPage();
      await serve(np);
      await np.goto(NEWS_URL, { waitUntil: "load" });
      await sleep(900);
      const out = await np.evaluate(() => ({
        ad1: document.getElementById("ad1")?.getAttribute("data-aj-web") ?? null,
        ad2: document.getElementById("ad2")?.getAttribute("data-aj-web") ?? null,
        seo: document.querySelector("#seo a")?.getAttribute("data-aj-web") ?? null,
        photo: document.getElementById("photo")?.closest("[data-aj-web]") ? "hidden" : null,
        ad1Visible: getComputedStyle(document.getElementById("ad1")!).display !== "none",
        placeholders: document.querySelectorAll(".aj-web-ph").length,
      }));
      await np.close();
      return out;
    };
    const off = await newsMarks();
    check("all-sites scan is off by default", off.ad1 === null && off.placeholders === 0);
    await send({ type: "settings:update", patch: { webScan: true } });
    const on = await newsMarks();
    check("all-sites: judol banner + ad unit hidden", on.ad1 === "banner" && !on.ad1Visible && on.ad2 === "banner", JSON.stringify(on));
    check("all-sites: SEO spam link marked, normal photo untouched", on.seo === "link" && on.photo === null && on.placeholders === 2, JSON.stringify(on));

    const hp = await browser!.newPage();
    await serve(hp);
    await hp.goto(HACKED_URL, { waitUntil: "load" });
    await sleep(700);
    check("hacked page shows a warning overlay", !!(await hp.$(".aj-page-warn")));
    await hp.close();
    await send({ type: "settings:update", patch: { webScan: false } });
    const regs3 = await worker!.evaluate(() => chrome.scripting.getRegisteredContentScripts().then((r) => r.map((x) => x.id)));
    check("disabling all-sites unregisters its script", !regs3.includes("aj-web"), JSON.stringify(regs3));
  }

  if (TS_KEY) {
    await opts.type("#apiKey", TS_KEY);
    await opts.click('input[name="remoteConsent"]');
    await opts.click('button[type="submit"]');
    await sleep(500);
    const view = await send({ type: "settings:get" });
    const leaked = JSON.stringify(view).includes(TS_KEY.slice(8, 30));
    check("saved key is never returned to UI", !leaked && typeof (view.keys as { typesafe: string }).typesafe === "string", String((view.keys as { typesafe: string }).typesafe));
    check("key field cleared after save", (await opts.$eval("#apiKey", (e) => (e as HTMLInputElement).value)) === "");

    await opts.click("#test");
    await opts.waitForFunction(() => /✓|✗/.test(document.getElementById("testResult")?.textContent ?? ""), { timeout: 20_000 });
    const tr = await opts.$eval("#testResult", (e) => e.textContent ?? "");
    check("options: 'Tes koneksi Jev' succeeds", tr.startsWith("✓"), tr);

    await send({ type: "cache:clear" });
    const direct = await send({ type: "classify", items: [{ key: "dbg1", surface: "comment", text: SUBTLE, localScore: 0.2, priority: 1 }] });
    const cfgNow = await send({ type: "state:get", pageKey: "youtube.com/watch?v=e2etest", siteKey: "youtube.com" });
    check("worker classify → Jev verdict", JSON.stringify(direct).includes('"source":"jev"'), JSON.stringify(direct));
    check("content config: jevAvailable", cfgNow.jevAvailable === true, JSON.stringify(cfgNow).slice(0, 160));
    await send({ type: "cache:clear" });
    // Low-score comments are only sent once visible; background tabs don't report visibility.
    await page.bringToFront();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      (t) => [...document.querySelectorAll("ytd-comment-view-model")].some((e) => e.textContent?.includes(t) && e.getAttribute("data-aj-source") === "jev"),
      { timeout: 20_000 },
      SUBTLE,
    ).catch(() => {});
    st = await states(page);
    const src = await page.$$eval("ytd-comment-view-model[data-aj-source]", (els) => els.map((e) => e.getAttribute("data-aj-source")));
    check("Jev: subtle spam caught (local filter misses it)", st[SUBTLE] === "suspicious" || st[SUBTLE] === "judol", `state=${st[SUBTLE]}`);
    check("Jev: news about judi stays SAFE", st[SAFE[1]!] === null);
    check("Jev verdicts applied", src.includes("jev") || src.includes("cache"), JSON.stringify(src));
    const usage = (await send({ type: "settings:get" })).usage as { today: number };
    check("daily usage counter increments", usage.today > 0, `${usage.today} items today`);
  } else {
    results.push("- skipped live Jev checks (set TS_KEY to run)");
  }

  await page.screenshot({ path: join(tmpdir(), "aj-e2e.png") });
  check("no errors in extension pages / service worker", extErrors.length === 0, extErrors.join(" | "));
} catch (e) {
  check("e2e run", false, String((e as Error).stack ?? e));
} finally {
  clearTimeout(watchdog);
  await browser?.close().catch(() => browser?.process()?.kill("SIGKILL"));
  await rm(profile, { recursive: true, force: true });
  await rm(E2E_DIST, { recursive: true, force: true });
}

console.log(`\n${results.length - failed} ok, ${failed} failed`);
process.exit(failed ? 1 : 0);
