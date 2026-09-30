/**
 * Records the README demo in a real Chrome with the built extension loaded (local mode, no API key):
 *   docs/demo.gif         animated walkthrough
 *   docs/screenshot.png   2× hero screenshot (page + popup)
 *
 *   bun run demo          (HEADFUL=1 to watch it)
 *
 * The page is a YouTube-style mock served at a real youtube.com URL so the content script runs
 * exactly as in production. Frames are captured per scene step, so timing is deterministic.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GIFEncoder, applyPalette, quantize } from "gifenc";
import { PNG } from "pngjs";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

const CHROME =
  process.env.CHROME_BIN ??
  (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
const URL_ = "https://www.youtube.com/watch?v=demo";
const VIEW = { width: 1200, height: 750 };
const GIF_SCALE = 0.8; // 960×600 GIF

const COMMENTS: Array<[author: string, text: string, when: string]> = [
  ["@rinaputri", "Makasih reviewnya kak, jadi yakin beli yang ini 🙏", "2 jam lalu"],
  ["@𝐉𝐔𝐃𝐈𝟖𝟖𝟖 𝐑𝐄𝐒𝐌𝐈", "s l o t g4c0r hari ini auto maxwin, cek bio 🔥", "1 jam lalu"],
  ["@budi.santoso", "Kameranya lumayan juga buat harga segini", "1 jam lalu"],
  ["@user-kx82", "ｄｅｐｏ １０ｒｂ ｂｉｓａ ｗｄ ｊｕｔａａｎ di KASINO310 (dot) com", "58 menit lalu"],
  ["@dewi_ayu", "Berita kemarin bikin sedih, banyak yang bangkrut gara-gara judol. Stop judi online!", "40 menit lalu"],
  ["@PULAU777 RESMI", "Main di PULAU777 auto jp paus, link di profil", "31 menit lalu"],
  ["@agus.tekno", "Bang review yang 3 jutaan juga dong", "12 menit lalu"],
];
const VIDEOS: Array<[string, string, string]> = [
  ["Top 5 HP Gaming Murah 2026", "Tekno Harian", "linear-gradient(135deg,#1e3c72,#2a5298)"],
  ["POLA SLOT GACOR HARI INI MAXWIN 🔥 JP PAUS", "gacor official", "linear-gradient(135deg,#f7971e,#ffd200)"],
  ["Cara Merawat Baterai HP Biar Awet", "Gadget Nusantara", "linear-gradient(135deg,#11998e,#38ef7d)"],
  ["Unboxing Tablet 3 Jutaan", "Review Jujur", "linear-gradient(135deg,#8e2de2,#4a00e0)"],
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let browser: Browser | undefined;
const profile = await mkdtemp(join(tmpdir(), "aj-demo-"));
const watchdog = setTimeout(async () => {
  console.error("✗ watchdog: demo exceeded 150s");
  browser?.process()?.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
  process.exit(2);
}, 150_000);

const frames: Array<{ png: Buffer; delay: number }> = [];
async function frame(page: Page, delay: number): Promise<void> {
  frames.push({ png: Buffer.from(await page.screenshot({ type: "png", captureBeyondViewport: false })), delay });
}

async function cursorTo(page: Page, selector: string, steps = 6): Promise<void> {
  const box = await (await page.$(selector))!.boundingBox();
  if (!box) return;
  const tx = box.x + box.width / 2, ty = box.y + box.height / 2;
  const from = (await page.evaluate(() => {
    const c = document.getElementById("cursor")!;
    return [parseFloat(c.style.left) || 700, parseFloat(c.style.top) || 500];
  })) as [number, number];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, e = t * t * (3 - 2 * t);
    await page.evaluate((x, y) => (window as unknown as { moveCursor(x: number, y: number): void }).moveCursor(x, y), from[0] + (tx - from[0]) * e, from[1] + (ty - from[1]) * e);
    await frame(page, 50);
  }
}

try {
  const icon = `data:image/png;base64,${(await readFile("static/icons/icon-32.png")).toString("base64")}`;
  const html = (await readFile("scripts/demo/fixture.html", "utf8")).replace("__ICON__", icon);

  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: !process.env.HEADFUL,
    pipe: true,
    enableExtensions: [resolve("dist")],
    userDataDir: profile,
    defaultViewport: { ...VIEW, deviceScaleFactor: GIF_SCALE },
    args: ["--no-first-run", "--no-default-browser-check", "--disable-sync", "--hide-scrollbars"],
  });
  const swTarget = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("/background.js"), { timeout: 15_000 });
  const sw = (await swTarget.worker())!;
  await sleep(500);
  for (const p of await browser.pages()) if (p.url().includes("options.html")) await p.close();

  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await page.setRequestInterception(true);
  page.on("request", (r) => (r.url().startsWith(URL_) ? r.respond({ status: 200, contentType: "text/html", body: html }) : r.abort()));
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  await sleep(400);

  const api = <T>(fn: string, ...args: unknown[]) =>
    page.evaluate((f, a) => (window as unknown as Record<string, (...x: unknown[]) => T>)[f]!(...a), fn, args) as Promise<T>;

  // Scene 1: sidebar loads; the gambling video title is blurred on arrival.
  await frame(page, 700);
  for (const v of VIDEOS) {
    await api("addVideo", ...v);
    await sleep(380);
    await frame(page, 260);
  }
  await frame(page, 900);

  // Scene 2: comments stream in; spam is blurred the moment it appears.
  await page.evaluate(() => window.scrollTo({ top: 290, behavior: "instant" }));
  await frame(page, 400);
  for (const [i, c] of COMMENTS.entries()) {
    await api("addComment", ...c, i);
    await sleep(380);
    await frame(page, i % 2 ? 650 : 450);
  }
  await frame(page, 1200);

  // Scene 3: reveal one, hide again.
  const second = "#comments ytd-comment-view-model:nth-child(2)";
  await cursorTo(page, `${second} button[data-aj-act="reveal"]`);
  await page.click(`${second} button[data-aj-act="reveal"]`);
  await sleep(200);
  await frame(page, 1600);
  await page.click(`${second} button[data-aj-act="reveal"]`);
  await sleep(200);
  await frame(page, 700);

  // Scene 4: toolbar popup with page stats (real popup, captured and overlaid on the mock toolbar).
  await cursorTo(page, "#extIcon");
  await page.bringToFront();
  let popupShot: string | null = null;
  try {
    await sw.evaluate(() => chrome.action.openPopup());
    const pt = await browser.waitForTarget((t) => t.url().endsWith("/popup.html"), { timeout: 5000 });
    const popup = (await pt.asPage())!;
    await popup.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
    await sleep(1300);
    popupShot = `data:image/png;base64,${Buffer.from(await (await popup.$("body"))!.screenshot({ type: "png" })).toString("base64")}`;
    await popup.close().catch(() => {});
  } catch (e) {
    console.warn("popup capture skipped:", (e as Error).message);
  }
  if (popupShot) {
    await api("showPopup", popupShot);
    await page.evaluate(() => (window as unknown as { moveCursor(x: number, y: number): void }).moveCursor(-50, -50));
    await sleep(150);
    await frame(page, 3200);
  }

  // Hero screenshot at 2×.
  await page.setViewport({ ...VIEW, deviceScaleFactor: 2 });
  await page.evaluate(() => window.scrollTo(0, 290)); // viewport change resets scroll; frame the comments
  await sleep(400);
  await writeFile("docs/screenshot.png", await page.screenshot({ type: "png" }));
  console.log("✓ docs/screenshot.png");

  // Encode GIF.
  const gif = GIFEncoder();
  for (const f of frames) {
    const { width, height, data } = PNG.sync.read(f.png);
    const palette = quantize(data, 256, { format: "rgb565" });
    gif.writeFrame(applyPalette(data, palette, "rgb565"), width, height, { palette, delay: f.delay });
  }
  gif.finish();
  if (process.env.DUMP_FRAME) await writeFile(process.env.DUMP_FRAME, frames[Math.floor(frames.length * 0.72)]!.png);
  await writeFile("docs/demo.gif", gif.bytes());
  console.log(`✓ docs/demo.gif (${frames.length} frames, ${(gif.bytes().length / 1024 / 1024).toFixed(2)} MB)`);
} finally {
  clearTimeout(watchdog);
  await browser?.close().catch(() => browser?.process()?.kill("SIGKILL"));
  await rm(profile, { recursive: true, force: true });
}
