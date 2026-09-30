import { beforeEach, describe, expect, test } from "bun:test";
import { Scanner } from "../src/content/scanner";
import type { ClassifyItem, ClassifyResult, ContentConfig } from "../src/shared/messages";
import { pageKeyOf, resolveActive, siteKeyOf } from "../src/shared/page";

const cfg = (over: Partial<ContentConfig> = {}): ContentConfig => ({
  active: true,
  reason: "global",
  action: "blur",
  sensitivity: "normal",
  blurSuspicious: true,
  preblurLocal: true,
  surfaces: { comment: true, live_chat: true, video_title: true },
  platforms: { youtube: true, x: false, reddit: false, facebook: false, instagram: false, tiktok: false, twitch: false, disqus: false },
  webScan: false,
  customBlock: [],
  customAllow: [],
  jevAvailable: true,
  allowKeys: [],
  ...over,
});

function comment(text: string, author = "@user"): HTMLElement {
  const el = document.createElement("ytd-comment-view-model");
  const a = document.createElement("span");
  a.id = "author-text";
  a.textContent = author;
  const t = document.createElement("span");
  t.id = "content-text";
  t.textContent = text;
  el.append(a, t);
  return el;
}

const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));

/** happy-dom never fires IntersectionObserver; this fake reports every observed element as visible. */
class FakeIO {
  constructor(private cb: IntersectionObserverCallback) {}
  observe(target: Element) {
    queueMicrotask(() =>
      this.cb([{ target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], this as never),
    );
  }
  unobserve() {}
  disconnect() {}
}
(globalThis as { IntersectionObserver: unknown }).IntersectionObserver = FakeIO;

/** Fake Jev: anything whose normalized text contains "promo" is judol. */
function fakeClassify(log: ClassifyItem[][]) {
  return async (items: ClassifyItem[]): Promise<ClassifyResult[]> => {
    log.push(items);
    return items.map((i) => ({
      key: i.key,
      verdict: /promo|gacor/i.test(i.text) ? "JUDOL_PROMO" : "SAFE",
      source: "jev",
      pJudol: 0.9,
    }));
  };
}

describe("scanner", () => {
  let log: ClassifyItem[][];
  let scanner: Scanner;
  let host: HTMLElement;

  beforeEach(() => {
    scanner?.stop();
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.append(host);
    log = [];
    scanner = new Scanner(document, { classify: fakeClassify(log), onAllow: () => {} });
  });

  test("strong local hit is blurred synchronously, before Jev answers", async () => {
    scanner.start(cfg());
    const el = comment("s l o t g4c0r maxwin, depo 10rb di GACOR88 . com");
    host.append(el);
    await Promise.resolve(); // MutationObserver microtask only — no timers
    expect(el.getAttribute("data-aj-state")).toBe("judol");
    expect(el.querySelector(".aj-badge")).not.toBeNull();
  });

  test("many added comments are batched into one classify message", async () => {
    scanner.start(cfg({ jevAvailable: true }));
    for (let i = 0; i < 30; i++) host.append(comment(i % 3 === 0 ? `cek promo bio ${i}` : `komentar biasa nomor ${i}`));
    await tick();
    // 30 comments (all visible via FakeIO) → one coalesced message to the service worker.
    expect(log).toHaveLength(1);
    expect(log[0]).toHaveLength(30);
  });

  test("Jev verdict marks and clears", async () => {
    scanner.start(cfg());
    const bad = comment("daftar situs promo slot sekarang");
    const good = comment("mantap bang videonya");
    host.append(bad, good);
    await tick();
    expect(bad.getAttribute("data-aj-state")).toBe("judol");
    expect(good.hasAttribute("data-aj-state")).toBe(false);
  });

  test("local-only mode when Jev is unavailable", async () => {
    scanner.start(cfg({ jevAvailable: false }));
    const el = comment("ｓｌｏｔ ｇａｃｏｒ maxwin depo 10rb");
    host.append(el);
    await tick();
    expect(el.getAttribute("data-aj-state")).toBe("judol");
    expect(log).toHaveLength(0);
  });

  test("recycled node (text changed) is re-evaluated", async () => {
    scanner.start(cfg({ jevAvailable: false }));
    const el = comment("slot gacor maxwin depo 10rb link bio");
    host.append(el);
    await tick();
    expect(el.getAttribute("data-aj-state")).toBe("judol");
    el.querySelector("#content-text")!.textContent = "lagu ini bagus banget";
    await tick();
    expect(el.hasAttribute("data-aj-state")).toBe(false);
  });

  test("'Bukan judol' whitelists the key and unmarks all copies", async () => {
    const allowed: string[] = [];
    scanner = new Scanner(document, { classify: fakeClassify(log), onAllow: (k) => allowed.push(k) });
    scanner.start(cfg({ jevAvailable: false }));
    const a = comment("slot gacor maxwin depo 10rb link bio");
    const b = comment("slot gacor maxwin depo 10rb link bio");
    host.append(a, b);
    await tick();
    a.querySelector<HTMLButtonElement>('button[data-aj-act="allow"]')!.click();
    expect(allowed).toHaveLength(1);
    expect(a.hasAttribute("data-aj-state")).toBe(false);
    expect(b.hasAttribute("data-aj-state")).toBe(false);
  });

  test("reveal-all flag + inactive page clears everything", async () => {
    scanner.start(cfg({ jevAvailable: false }));
    const el = comment("slot gacor maxwin depo 10rb link bio");
    host.append(el);
    await tick();
    scanner.setRevealAll(true);
    expect(document.documentElement.hasAttribute("data-aj-reveal-all")).toBe(true);
    scanner.start(cfg({ active: false }));
    expect(el.hasAttribute("data-aj-state")).toBe(false);
  });

  test("perf: 500 comments processed within frame budget slices", async () => {
    scanner.start(cfg({ jevAvailable: false }));
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 500; i++) frag.append(comment(i % 5 ? `komentar biasa ${i} mantap` : `slot gacor ${i} maxwin`));
    host.append(frag);
    await tick(300);
    expect(scanner.stats.scanned).toBe(500);
    expect(scanner.stats.judol).toBe(100);
    // happy-dom is slower than Chrome; this only guards against pathological regressions.
    expect(scanner.perf.totalMs / scanner.perf.items).toBeLessThan(1);
  });
});

describe("per-page controls", () => {
  test("page keys ignore YouTube URL noise and merge live chat with its video", () => {
    const k = "youtube.com/watch?v=abc123";
    expect(pageKeyOf("https://www.youtube.com/watch?v=abc123&t=42s&list=PL1")).toBe(k);
    expect(pageKeyOf("https://m.youtube.com/watch?v=abc123")).toBe(k);
    expect(pageKeyOf("https://www.youtube.com/live_chat?v=abc123&is_popout=1")).toBe(k);
    expect(pageKeyOf("https://www.youtube.com/shorts/XYZ?feature=share")).toBe("youtube.com/shorts/XYZ");
    expect(siteKeyOf("https://www.youtube.com/")).toBe("youtube.com");
  });

  test("precedence: page > site > global", () => {
    const rules = { sites: { "youtube.com": false }, pages: { p1: { on: true, at: 0 } } };
    expect(resolveActive({ enabled: true }, rules, "youtube.com", "p1")).toEqual({ active: true, reason: "page" });
    expect(resolveActive({ enabled: true }, rules, "youtube.com", "p2")).toEqual({ active: false, reason: "site" });
    expect(resolveActive({ enabled: false }, { sites: {}, pages: {} }, "x", "y")).toEqual({ active: false, reason: "global" });
  });
});

describe("report button", () => {
  test("'Laporkan' passes the comment, author and platform", async () => {
    const reports: Array<{ text: string; author: string; where: string }> = [];
    const s = new Scanner(document, { classify: async () => [], onAllow: () => {}, onReport: (r) => reports.push(r) });
    document.body.innerHTML = "";
    s.start(cfg({ jevAvailable: false }));
    const el = comment("slot gacor maxwin depo 10rb link bio", "@SLOT88");
    document.body.append(el);
    await tick();
    el.querySelector<HTMLButtonElement>('button[data-aj-act="report"]')!.click();
    expect(reports).toEqual([{ text: "slot gacor maxwin depo 10rb link bio", author: "@SLOT88", where: "komentar YouTube" }]);
    s.stop();
  });
});
