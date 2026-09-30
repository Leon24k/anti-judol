/**
 * All-sites scanner (opt-in): hides gambling banners, ad iframes and injected judol links on
 * ordinary websites, and warns when a whole page is judol spam (typical for hacked .go.id/.ac.id).
 * Local only: page text never leaves the device. Hosts are checked against the blocklist held by
 * the service worker (in-extension message, no network).
 */
import { THRESHOLDS } from "../shared/decide";
import { compileCustom, customVerdict, scoreText, type CustomWords } from "../shared/heuristics";
import { normalize } from "../shared/normalize";
import type { ContentConfig, PageStats } from "../shared/messages";
import { ADUAN_URL, reportText } from "../shared/report";
import { bannerText, hostLooksJudol, hostOf, textLooksJudol } from "../shared/webscan";

const TARGETS = "a[href], img, iframe, embed, object[data]";
const SLICE_BUDGET_MS = 8;
const CHECK_MAX = 200;

export interface WebDeps {
  /** Which of these hosts are on the gambling blocklist. */
  checkHosts(hosts: string[]): Promise<string[]>;
}

type Kind = "banner" | "frame" | "link";

export class WebScanner {
  private cfg: ContentConfig | null = null;
  private mo: MutationObserver | null = null;
  private dirty = new Set<Node>();
  private seen = new WeakSet<Element>();
  private hostVerdict = new Map<string, boolean>();
  private pendingHosts = new Map<string, Set<Element>>();
  private checkTimer: ReturnType<typeof setTimeout> | undefined;
  private sliceTimer: ReturnType<typeof setTimeout> | undefined;
  private uninstall: (() => void) | null = null;
  private hidden = 0;
  private scanned = 0;
  private pageWarned = false;
  private custom: CustomWords = { block: [], allow: [] };
  private readonly base: string;

  constructor(
    private readonly doc: Document,
    private readonly d: WebDeps,
  ) {
    this.base = doc.location?.href ?? "https://x.invalid/";
  }

  get stats(): PageStats {
    return { scanned: this.scanned, judol: this.hidden, suspicious: 0 };
  }

  get revealed(): boolean {
    return this.doc.documentElement.hasAttribute("data-aj-reveal-all");
  }

  setRevealAll(on: boolean): void {
    this.doc.documentElement.toggleAttribute("data-aj-reveal-all", on);
  }

  resetPageStats(): void {
    this.hidden = 0;
    this.scanned = 0;
    this.setRevealAll(false);
  }

  start(cfg: ContentConfig): void {
    this.cfg = cfg;
    this.custom = compileCustom(cfg.customBlock, cfg.customAllow);
    if (!cfg.active || !cfg.webScan) return this.stop();
    if (!this.mo) {
      this.mo = new MutationObserver((recs) => {
        for (const r of recs) {
          if (r.type === "attributes") this.dirty.add(r.target);
          else for (const n of r.addedNodes) if (n.nodeType === 1 && !isOurs(n as Element)) this.dirty.add(n);
        }
        this.flush();
      });
      this.mo.observe(this.doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["href", "src", "data-src"] });
      this.uninstall = this.installClicks();
    }
    this.dirty.add(this.doc.documentElement);
    this.flush();
    if (this.doc.readyState === "loading") this.doc.addEventListener("DOMContentLoaded", () => this.checkPage(), { once: true });
    else this.checkPage();
  }

  stop(): void {
    this.mo?.disconnect();
    this.mo = null;
    this.uninstall?.();
    this.uninstall = null;
    clearTimeout(this.sliceTimer);
    this.sliceTimer = undefined;
    this.dirty.clear();
    for (const el of this.doc.querySelectorAll("[data-aj-web]")) el.removeAttribute("data-aj-web");
    for (const el of this.doc.querySelectorAll(".aj-web-ph, .aj-page-warn")) el.remove();
    this.seen = new WeakSet();
  }

  // ---------- element scan ----------

  private flush(): void {
    if (!this.cfg?.webScan || this.dirty.size === 0) return;
    const t0 = performance.now();
    const found: Element[] = [];
    for (const n of this.dirty) {
      const el = n as Element;
      if (el.matches?.(TARGETS)) found.push(el);
      for (const x of el.querySelectorAll?.(TARGETS) ?? []) found.push(x);
    }
    this.dirty.clear();
    let i = 0;
    for (; i < found.length; i++) {
      if ((i & 15) === 15 && performance.now() - t0 > SLICE_BUDGET_MS) break;
      this.inspect(found[i]!);
    }
    if (i < found.length) {
      for (const el of found.slice(i)) this.dirty.add(el);
      this.sliceTimer ??= setTimeout(() => {
        this.sliceTimer = undefined;
        this.flush();
      }, 0);
    }
  }

  private inspect(el: Element): void {
    if (this.seen.has(el) || isOurs(el)) return;
    this.seen.add(el);
    this.scanned++;
    const kind: Kind = el.tagName === "A" ? (el.querySelector("img, picture, video, iframe") ? "banner" : "link") : el.tagName === "IMG" ? "banner" : "frame";
    const url = el.getAttribute("href") ?? el.getAttribute("src") ?? el.getAttribute("data-src") ?? el.getAttribute("data");
    const host = hostOf(url, this.base);
    const self = hostOf(this.base, this.base);
    const threshold = THRESHOLDS[this.cfg!.sensitivity].localInstant;

    // Same-site images are never ads by themselves; judge them only by their text.
    if (host && host !== self) {
      if (hostLooksJudol(host)) return this.hide(el, kind, host);
      const known = this.hostVerdict.get(host);
      if (known === true) return this.hide(el, kind, host);
      if (known === undefined) this.queueHost(host, el, kind);
    }
    const text = kind === "link" ? (el.textContent ?? "") : bannerText(el);
    const cv = text.trim().length >= 2 ? customVerdict(normalize(text), this.custom) : null;
    if (cv === "block" || (cv !== "allow" && textLooksJudol(text, threshold))) this.hide(el, kind, host ?? "");
  }

  private queueHost(host: string, el: Element, kind: Kind): void {
    let set = this.pendingHosts.get(host);
    if (!set) this.pendingHosts.set(host, (set = new Set()));
    set.add(el);
    el.setAttribute("data-aj-kind", kind);
    this.checkTimer ??= setTimeout(() => void this.runChecks(), 60);
  }

  private async runChecks(): Promise<void> {
    this.checkTimer = undefined;
    const hosts = [...this.pendingHosts.keys()].slice(0, CHECK_MAX);
    const waiting = hosts.map((h) => [h, this.pendingHosts.get(h)!] as const);
    for (const h of hosts) this.pendingHosts.delete(h);
    let bad: Set<string>;
    try {
      bad = new Set(await this.d.checkHosts(hosts));
    } catch {
      bad = new Set();
    }
    for (const [h, els] of waiting) {
      this.hostVerdict.set(h, bad.has(h));
      if (bad.has(h)) for (const el of els) if (el.isConnected) this.hide(el, (el.getAttribute("data-aj-kind") as Kind) ?? "banner", h);
    }
    if (this.pendingHosts.size) this.checkTimer ??= setTimeout(() => void this.runChecks(), 60);
  }

  /** Hide the whole ad unit, not just the <img>: climb through wrappers that hold nothing else. */
  private adUnit(el: Element, kind: Kind): Element {
    if (kind === "link") return el;
    let unit: Element = el.closest("a") ?? el;
    for (let i = 0; i < 3; i++) {
      const p = unit.parentElement;
      if (!p || p === this.doc.body || p === this.doc.documentElement) break;
      if (p.children.length !== 1 || (p.textContent ?? "").trim().length > (unit.textContent ?? "").trim().length + 20) break;
      unit = p;
    }
    return unit;
  }

  private hide(el: Element, kind: Kind, host: string): void {
    const unit = this.adUnit(el, kind);
    if (unit.hasAttribute("data-aj-web")) return;
    this.hidden++;
    unit.setAttribute("data-aj-web", kind === "link" ? "link" : "banner");
    unit.setAttribute("data-aj-host", host);
    if (kind === "link") return;
    const ph = this.doc.createElement("div");
    ph.className = "aj-web-ph";
    ph.setAttribute("role", "note");
    const label = this.doc.createElement("span");
    label.textContent = "⚠ Iklan judi online disembunyikan";
    ph.append(label, btn(this.doc, "web-reveal", "Lihat"), btn(this.doc, "web-report", "Laporkan"));
    unit.before(ph);
  }

  // ---------- whole-page check ----------

  /** A page whose own title/heading is judol promo (e.g. hacked campus site) gets an overlay. */
  private checkPage(): void {
    if (this.pageWarned || !this.cfg?.webScan || this.doc !== this.doc.defaultView?.top?.document) return;
    const title = this.doc.title ?? "";
    const h1 = this.doc.querySelector("h1")?.textContent ?? "";
    const desc = this.doc.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
    const score = scoreText(`${title} ${h1} ${desc}`.slice(0, 500)).score;
    if (score < THRESHOLDS[this.cfg.sensitivity].localInstant) return;
    this.pageWarned = true;
    const o = this.doc.createElement("div");
    o.className = "aj-page-warn";
    o.setAttribute("role", "alertdialog");
    o.setAttribute("aria-label", "Peringatan halaman judi online");
    const box = this.doc.createElement("div");
    const h = this.doc.createElement("strong");
    h.textContent = "Halaman ini berisi promosi judi online";
    const p = this.doc.createElement("p");
    p.textContent = `${location.hostname} kemungkinan diretas dan disusupi iklan judi. Jangan masukkan data pribadi atau melakukan transfer.`;
    box.append(h, p, btn(this.doc, "page-back", "Kembali"), btn(this.doc, "web-report", "Laporkan ke aduankonten.id"), btn(this.doc, "page-stay", "Tetap lihat"));
    o.append(box);
    (this.doc.body ?? this.doc.documentElement).append(o);
  }

  // ---------- interactions ----------

  private installClicks(): () => void {
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null;
      const b = t?.closest?.<HTMLElement>("[data-aj-act^='web-'], [data-aj-act^='page-']");
      if (b && isOurs(b)) {
        e.preventDefault();
        e.stopPropagation();
        const act = b.dataset.ajAct;
        if (act === "web-reveal") {
          const unit = b.parentElement?.nextElementSibling;
          if (unit?.hasAttribute("data-aj-web")) {
            const on = !unit.hasAttribute("data-aj-web-revealed");
            unit.toggleAttribute("data-aj-web-revealed", on);
            b.textContent = on ? "Sembunyikan" : "Lihat";
          }
        } else if (act === "web-report") {
          const unit = b.closest(".aj-page-warn") ? null : b.parentElement?.nextElementSibling;
          const host = unit?.getAttribute("data-aj-host");
          this.report(host ? `https://${host}/` : location.href, host ? "iklan/banner judi di situs lain" : "halaman situs (diduga diretas)");
        } else if (act === "page-stay") b.closest(".aj-page-warn")?.remove();
        else if (act === "page-back") history.length > 1 ? history.back() : b.closest(".aj-page-warn")?.remove();
        return;
      }
      // First click on a blurred judol link reveals instead of navigating.
      const link = t?.closest?.("a[data-aj-web='link']:not([data-aj-web-revealed])");
      if (link && !this.revealed) {
        e.preventDefault();
        e.stopPropagation();
        link.setAttribute("data-aj-web-revealed", "");
      }
    };
    this.doc.addEventListener("click", onClick, true);
    return () => this.doc.removeEventListener("click", onClick, true);
  }

  private report(url: string, where: string): void {
    const text = reportText({ url, where: `${where} (${location.hostname})` });
    void navigator.clipboard?.writeText(text).catch(() => {});
    window.open(ADUAN_URL, "_blank", "noopener");
  }
}

function btn(doc: Document, act: string, text: string): HTMLButtonElement {
  const b = doc.createElement("button");
  b.type = "button";
  b.dataset.ajAct = act;
  b.textContent = text;
  return b;
}

function isOurs(el: Element): boolean {
  return !!el.closest?.(".aj-web-ph, .aj-page-warn, .aj-badge");
}
