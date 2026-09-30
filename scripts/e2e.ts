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
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

const CHROME =
  process.env.CHROME_BIN ??
  (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
const TS_KEY = process.env.TS_KEY ?? "";
const HEADLESS = process.env.HEADFUL ? false : true;
const DIST = resolve("dist");
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

async function serve(page: Page): Promise<void> {
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const u = r.url();
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
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: HEADLESS,
    pipe: true,
    enableExtensions: [DIST],
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
}

console.log(`\n${results.length - failed} ok, ${failed} failed`);
process.exit(failed ? 1 : 0);
