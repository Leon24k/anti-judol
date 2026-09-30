import { afterEach, describe, expect, test } from "bun:test";
import { WebScanner } from "../src/content/web";
import type { ContentConfig } from "../src/shared/messages";
import { PLATFORMS, type PlatformId } from "../src/shared/platforms";
import { bannerText, hostLooksJudol, textLooksJudol } from "../src/shared/webscan";

describe("domain-name heuristic", () => {
  test.each([
    "agenslots77.com", "slotgacor.xyz", "situsjudi.net", "toto88.com", "rajapoker88.org", "dewatogel.id", "maxwin-hari-ini.site",
    "judi88.com", "zeus123.vip", "slot-online-88.com", "kasino310.com", "www.linkalternatif-sbobet.com", "polaslot.site",
  ])("flags %p", (h) => expect(hostLooksJudol(h)).toBe(true));

  test.each([
    "google.com", "toto.com", "bet.com", "judith.com", "slotcars.co.uk", "scatterplot.io", "spin.com", "pokerface-band.com",
    "bandarlampungkota.go.id", "sloth.org", "totoro.jp", "jpmorgan.com", "zeus.io", "olympus-global.com", "mahjongsoul.com",
    "hokiday.com", "ui.ac.id", "bandara.id", "cdn.slot.example.go.id",
  ])("does not flag %p", (h) => expect(hostLooksJudol(h)).toBe(false));
});

describe("banner text", () => {
  test("uses alt, title and file name", () => {
    const img = document.createElement("img");
    img.setAttribute("src", "/wp-content/uploads/banner-slot_gacor-MAXWIN.gif?v=2");
    expect(bannerText(img)).toContain("banner slot gacor MAXWIN");
    img.setAttribute("alt", "Daftar sekarang");
    expect(bannerText(img)).toContain("Daftar sekarang");
  });
  test("promo vs normal ads", () => {
    expect(textLooksJudol("banner slot gacor maxwin", 0.85)).toBe(true);
    expect(textLooksJudol("Promo Ramadhan diskon 50% sepatu", 0.85)).toBe(false);
  });
});

const cfg = (over: Partial<ContentConfig> = {}): ContentConfig => ({
  active: true,
  reason: "global",
  action: "blur",
  sensitivity: "normal",
  blurSuspicious: true,
  preblurLocal: true,
  surfaces: { comment: true, live_chat: true, video_title: true },
  platforms: Object.fromEntries(PLATFORMS.map((p) => [p.id, true])) as Record<PlatformId, boolean>,
  webScan: true,
  jevAvailable: false,
  allowKeys: [],
  ...over,
});
const tick = (ms = 120) => new Promise((r) => setTimeout(r, ms));

describe("WebScanner", () => {
  let ws: WebScanner | undefined;
  afterEach(() => {
    ws?.stop();
    document.body.innerHTML = "";
    document.title = "";
  });

  const page = `
    <article><h1>Resep nasi goreng</h1><p>Bahan: nasi, telur, kecap. <a href="/resep-lain">Resep lain</a></p></article>
    <div class="ad"><a href="https://agenslots77.com/daftar?ref=1"><img src="https://cdn.adnet.example/b1.gif" alt=""></a></div>
    <div class="sidebar"><div><a href="https://listed-casino.example/"><img src="/img/b2.jpg"></a></div></div>
    <p>Sponsor: <a href="https://toko-sepatu.example/">Toko sepatu</a> · <a href="https://example.org/x">SLOT GACOR HARI INI MAXWIN</a></p>
    <iframe src="https://ads.slotgacor.xyz/frame.html" width="300" height="250"></iframe>
    <img src="/uploads/banner-slot-gacor-maxwin.gif" alt="">
    <img src="/uploads/foto-nasi-goreng.jpg" alt="Nasi goreng">`;

  test("hides judol banners/iframes/links, leaves normal content", async () => {
    const asked: string[][] = [];
    ws = new WebScanner(document, { checkHosts: async (h) => (asked.push(h), h.filter((x) => x === "listed-casino.example")) });
    document.body.innerHTML = page;
    ws.start(cfg());
    await tick();

    const hidden = [...document.querySelectorAll("[data-aj-web]")];
    const hiddenHosts = hidden.map((e) => e.getAttribute("data-aj-host"));
    expect(hiddenHosts).toContain("agenslots77.com"); // domain-name heuristic
    expect(hiddenHosts).toContain("listed-casino.example"); // blocklist via worker
    expect(hiddenHosts).toContain("ads.slotgacor.xyz"); // iframe
    expect(document.querySelector('a[href="https://example.org/x"]')!.getAttribute("data-aj-web")).toBe("link"); // SEO spam anchor
    expect(document.querySelector('img[src="/uploads/banner-slot-gacor-maxwin.gif"]')!.closest("[data-aj-web]")).not.toBeNull();

    // Normal content untouched.
    expect(document.querySelector("article")!.hasAttribute("data-aj-web")).toBe(false);
    expect(document.querySelector('a[href="https://toko-sepatu.example/"]')!.hasAttribute("data-aj-web")).toBe(false);
    expect(document.querySelector('img[alt="Nasi goreng"]')!.closest("[data-aj-web]")).toBeNull();

    // Whole ad unit hidden (wrapper div), with a placeholder in front of it.
    expect(document.querySelector(".ad")!.getAttribute("data-aj-web")).toBe("banner");
    expect(document.querySelectorAll(".aj-web-ph").length).toBe(4);
    // Host checks are batched into one message; same-site and heuristic hits aren't asked.
    expect(asked.length).toBe(1);
    expect(asked[0]).not.toContain("www.youtube.com");
    expect(ws.stats.judol).toBe(5);
  });

  test("dynamically injected ads are caught", async () => {
    ws = new WebScanner(document, { checkHosts: async () => [] });
    ws.start(cfg());
    const a = document.createElement("a");
    a.href = "https://rajapoker88.org/";
    a.innerHTML = '<img src="https://cdn.example/x.png">';
    document.body.append(a);
    await tick();
    expect(a.closest("[data-aj-web]")).not.toBeNull();
  });

  test("reveal button shows the ad again", async () => {
    ws = new WebScanner(document, { checkHosts: async () => [] });
    document.body.innerHTML = page;
    ws.start(cfg());
    await tick();
    document.querySelector<HTMLButtonElement>('.aj-web-ph button[data-aj-act="web-reveal"]')!.click();
    expect(document.querySelector("[data-aj-web-revealed]")).not.toBeNull();
  });

  test("hacked page (judol title) gets a warning overlay", async () => {
    document.title = "SLOT GACOR MAXWIN Hari Ini - Situs Slot Online Terpercaya";
    ws = new WebScanner(document, { checkHosts: async () => [] });
    ws.start(cfg());
    await tick();
    expect(document.querySelector(".aj-page-warn")).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[data-aj-act="page-stay"]')!.click();
    expect(document.querySelector(".aj-page-warn")).toBeNull();
  });

  test("off when webScan is disabled; stop() restores the page", async () => {
    ws = new WebScanner(document, { checkHosts: async () => [] });
    document.body.innerHTML = page;
    ws.start(cfg({ webScan: false }));
    await tick();
    expect(document.querySelectorAll("[data-aj-web]").length).toBe(0);
    ws.start(cfg());
    await tick();
    expect(document.querySelectorAll("[data-aj-web]").length).toBeGreaterThan(0);
    ws.stop();
    expect(document.querySelectorAll("[data-aj-web], .aj-web-ph").length).toBe(0);
  });
});
