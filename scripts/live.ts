/**
 * Live-site selector check: opens REAL public pages with the built extension loaded and reports
 * whether each platform's adapters still find content (comments, titles, chat) on today's DOM.
 * Read-only: no login, no clicks except scrolling, nothing is posted.
 *
 *   bun run live            # all platforms
 *   bun run live youtube    # one platform
 *
 * Not part of CI: real sites are slow, geo/consent-dependent and change without notice.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { ADAPTERS } from "../src/content/adapters";
import type { PlatformId } from "../src/shared/platforms";

const CHROME =
  process.env.CHROME_BIN ??
  (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");

/** Public pages that normally have plenty of visible content. */
const TARGETS: Array<{ id: PlatformId; url: string; scrolls: number; need: Array<"comment" | "live_chat" | "video_title"> }> = [
  { id: "youtube", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", scrolls: 6, need: ["comment", "video_title"] },
  { id: "youtube", url: "https://www.youtube.com/results?search_query=review+hp+murah", scrolls: 2, need: ["video_title"] },
  { id: "reddit", url: "https://www.reddit.com/r/indonesia/", scrolls: 3, need: ["video_title"] },
  { id: "reddit", url: "https://old.reddit.com/r/indonesia/", scrolls: 1, need: ["video_title"] },
  { id: "twitch", url: "https://www.twitch.tv/directory/all", scrolls: 1, need: [] },
  { id: "x", url: "https://x.com/elonmusk", scrolls: 2, need: ["comment"] },
];

const only = process.argv[2] as PlatformId | undefined;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dist = join(tmpdir(), `aj-live-dist-${process.pid}`);
const profile = await mkdtemp(join(tmpdir(), "aj-live-"));
let browser: Browser | undefined;
const watchdog = setTimeout(() => {
  console.error("✗ watchdog (240s)");
  browser?.process()?.kill("SIGKILL");
  process.exit(2);
}, 240_000);

/** Dismiss common cookie/consent walls (EU consent.youtube.com etc.). */
async function consent(page: Page): Promise<void> {
  for (const label of ["Accept all", "Reject all", "Terima semua", "Tolak semua", "Accept"]) {
    const clicked = await page
      .evaluate((l) => {
        const b = [...document.querySelectorAll("button, tp-yt-paper-button")].find((x) => x.textContent?.trim() === l);
        (b as HTMLElement | undefined)?.click();
        return !!b;
      }, label)
      .catch(() => false);
    if (clicked) {
      await sleep(2500);
      return;
    }
  }
}

const rows: string[] = [];
let broken = 0;
try {
  await cp(resolve("dist"), dist, { recursive: true });
  const man = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
  man.host_permissions = [...man.host_permissions, ...man.optional_host_permissions.filter((h: string) => h !== "<all_urls>")];
  await writeFile(join(dist, "manifest.json"), JSON.stringify(man));

  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: !process.env.HEADFUL,
    pipe: true,
    enableExtensions: [dist],
    userDataDir: profile,
    defaultViewport: { width: 1280, height: 900 },
    args: ["--no-first-run", "--lang=en-US", ...(process.env.CI ? ["--no-sandbox"] : [])],
  });
  const sw = await browser.waitForTarget((t) => t.type() === "service_worker", { timeout: 15_000 });
  const worker = (await sw.worker())!;
  await sleep(500);
  for (const p of await browser.pages()) if (p.url().includes("options.html")) await p.close();
  // Enable every platform (hosts pre-granted in this throwaway build).
  await worker.evaluate(async () => {
    const k = "aj:settings";
    const cur = ((await chrome.storage.local.get(k))[k] ?? {}) as Record<string, unknown>;
    await chrome.storage.local.set({ [k]: { ...cur, platforms: { youtube: true, x: true, reddit: true, twitch: true, disqus: true, facebook: true, instagram: true, tiktok: true } } });
  });
  // Restart the worker so it re-reads settings and registers platform scripts.
  await worker.evaluate(() => chrome.runtime.reload()).catch(() => {});
  await sleep(2500);

  for (const t of TARGETS) {
    if (only && t.id !== only) continue;
    const page = await browser.newPage();
    // Headless Chrome's UA triggers bot challenges on some sites (e.g. Reddit).
    await page.setUserAgent((await browser.userAgent()).replace("HeadlessChrome", "Chrome"));
    let status = "";
    try {
      await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await sleep(3000);
      await consent(page);
      for (let i = 0; i < t.scrolls; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
        await sleep(1800);
      }
      const adapters = ADAPTERS[t.id].map((a) => ({ surface: a.surface, container: a.container, text: a.text }));
      const res = await page.evaluate((ads) => {
        const out: Record<string, { containers: number; withText: number; sample: string }> = {};
        for (const a of ads) {
          const els = [...document.querySelectorAll(a.container)];
          const withText = els.filter((e) => (e.querySelector(a.text)?.textContent ?? "").trim().length > 1);
          const o = (out[a.surface] ??= { containers: 0, withText: 0, sample: "" });
          o.containers += els.length;
          o.withText += withText.length;
          o.sample ||= (withText[0]?.querySelector(a.text)?.textContent ?? "").trim().slice(0, 50);
        }
        return { out, marked: document.querySelectorAll("[data-aj-state]").length, url: location.href, title: document.title };
      }, adapters);
      const parts = Object.entries(res.out).map(([s, o]) => `${s}: ${o.withText}/${o.containers}`);
      const missing = t.need.filter((s) => !res.out[s] || res.out[s]!.withText === 0);
      const blockedByWall = /login|consent|sign in|log in/i.test(res.url + " " + res.title) && Object.values(res.out).every((o) => o.containers === 0);
      if (blockedByWall) status = `? login/consent wall — ${res.url.slice(0, 60)}`;
      else if (missing.length) {
        broken++;
        status = `✗ missing ${missing.join(", ")} — ${parts.join(" · ")}`;
      } else status = `✓ ${parts.join(" · ")} · marked ${res.marked}${Object.values(res.out).find((o) => o.sample)?.sample ? ` · e.g. "${Object.values(res.out).find((o) => o.sample)!.sample}"` : ""}`;
    } catch (e) {
      status = `? could not load: ${(e as Error).message.slice(0, 80)}`;
    }
    rows.push(`${t.id.padEnd(8)} ${t.url.padEnd(62)} ${status}`);
    console.log(rows.at(-1));
    await page.close().catch(() => {});
  }
} finally {
  clearTimeout(watchdog);
  await browser?.close().catch(() => browser?.process()?.kill("SIGKILL"));
  await rm(profile, { recursive: true, force: true });
  await rm(dist, { recursive: true, force: true });
}
console.log(broken ? `\n${broken} target(s) with broken selectors` : "\nall reachable targets OK");
process.exit(broken ? 1 : 0);
