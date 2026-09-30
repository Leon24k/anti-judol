/**
 * Content-side engine. Two-tier pipeline:
 *
 *  MutationObserver (microtask, before paint)
 *    → collect dirty containers → normalize + local score (≈0.05ms each, 8ms budget per slice)
 *    → instant mark: strong local hit = blur now; medium = "pending" soft blur
 *  IntersectionObserver (600px lookahead)
 *    → only items near the viewport are sent to Jev (live chat + suspicious ones skip the wait)
 *  Outbox (40ms coalescing, ≤48 per message) → service worker scheduler → Jev
 *    → final verdict replaces the provisional mark
 */
import { localVerdict, THRESHOLDS } from "../shared/decide";
import { hashKey } from "../shared/hash";
import { compileCustom, customVerdict, scoreLocal, type CustomWords } from "../shared/heuristics";
import type { ClassifyItem, ClassifyResult, ContentConfig, PageStats } from "../shared/messages";
import { normalize } from "../shared/normalize";
import { platformById } from "../shared/platforms";
import type { Surface } from "../shared/settings";
import { Verdict } from "../shared/verdict";
import { adapterFor, adaptersForHost, extract, type AdapterSet } from "./adapters";
import { applyMark, clearAll, clearMark, installInteractions, isOurs, type MarkState } from "./ui";

const SLICE_BUDGET_MS = 8;
const SEND_WINDOW_MS = 40;
const SEND_MAX = 48;
const MAX_INFLIGHT = 4;
const MAX_VERDICTS = 5000;
const PRIORITY: Record<Surface, number> = { live_chat: 3, video_title: 2, comment: 1 };

interface Track {
  raw: string;
  /** Original (un-normalized) text + author, as the user saw it. For reports. */
  origText: string;
  origAuthor: string;
  key: string;
  surface: Surface;
  score: number;
  text: string;
  author: string;
}

export interface ScannerDeps {
  classify(items: ClassifyItem[]): Promise<ClassifyResult[]>;
  onAllow(key: string): void;
  /** Copy a ready-to-paste report and open aduankonten.id. */
  onReport?(r: { text: string; author: string; where: string }): void;
  now?(): number;
  /** Adapter set for this document; defaults to one derived from location.hostname. */
  adapters?: AdapterSet | null;
}

export class Scanner {
  private cfg: ContentConfig | null = null;
  private mo: MutationObserver | null = null;
  private io: IntersectionObserver | null = null;
  private uninstall: (() => void) | null = null;
  private dirty = new Set<Node>();
  private tracked = new WeakMap<Element, Track>();
  private verdicts = new Map<string, ClassifyResult>();
  private waiting = new Map<string, Set<Element>>();
  private outbox = new Map<string, ClassifyItem>();
  private allow = new Set<string>();
  private custom: CustomWords = { block: [], allow: [] };
  private sliceTimer: ReturnType<typeof setTimeout> | undefined;
  private sendTimer: ReturnType<typeof setTimeout> | undefined;
  private sweepTimer: ReturnType<typeof setInterval> | undefined;
  private inflight = 0;
  private readonly now: () => number;
  private readonly set: AdapterSet | null;

  private seen = new Set<string>();
  private judol = new Set<string>();
  private suspicious = new Set<string>();
  readonly perf = { slices: 0, items: 0, totalMs: 0, maxSliceMs: 0 };

  constructor(
    private readonly doc: Document,
    private readonly d: ScannerDeps,
  ) {
    this.now = d.now ?? (() => performance.now());
    this.set = d.adapters !== undefined ? d.adapters : adaptersForHost(doc.location?.hostname ?? "");
  }

  get platform(): string | null {
    return this.set?.platform ?? null;
  }

  get stats(): PageStats {
    return { scanned: this.seen.size, judol: this.judol.size, suspicious: this.suspicious.size };
  }

  get revealed(): boolean {
    return this.doc.documentElement.hasAttribute("data-aj-reveal-all");
  }

  setRevealAll(on: boolean): void {
    this.doc.documentElement.toggleAttribute("data-aj-reveal-all", on);
  }

  /** Apply (or re-apply) config. Any config change triggers a full, budgeted rescan. */
  start(cfg: ContentConfig): void {
    const prev = this.cfg;
    this.cfg = cfg;
    this.allow = new Set(cfg.allowKeys);
    this.custom = compileCustom(cfg.customBlock, cfg.customAllow);
    if (!cfg.active || !this.set || !cfg.platforms[this.set.platform]) return this.stop();
    if (prev && prev.sensitivity !== cfg.sensitivity) this.verdicts.clear();
    this.tracked = new WeakMap();
    this.waiting.clear();
    this.outbox.clear();
    clearAll(this.doc);

    if (!this.mo) {
      this.mo = new MutationObserver((records) => this.onMutations(records));
      this.mo.observe(this.doc.documentElement, { childList: true, subtree: true, characterData: true });
      this.uninstall = installInteractions(this.doc, {
        onAllow: (key, el) => this.allowKey(key, el),
        onReport: (el) => {
          const tr = this.tracked.get(el);
          if (!tr) return;
          const name = this.set ? platformById(this.set.platform).name : "situs";
          const kind = tr.surface === "live_chat" ? "live chat" : tr.surface === "video_title" ? "judul" : "komentar";
          this.d.onReport?.({ text: tr.origText, author: tr.origAuthor, where: `${kind} ${name}` });
        },
      });
      this.sweepTimer = setInterval(() => this.sweep(), 15_000);
    }
    this.io?.disconnect();
    this.io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => this.onVisible(entries), { rootMargin: "600px 0px" });
    this.dirty.add(this.doc.documentElement);
    this.flush();
  }

  stop(): void {
    this.mo?.disconnect();
    this.mo = null;
    this.io?.disconnect();
    this.io = null;
    this.uninstall?.();
    this.uninstall = null;
    clearInterval(this.sweepTimer);
    clearTimeout(this.sliceTimer);
    this.sliceTimer = undefined;
    this.dirty.clear();
    this.waiting.clear();
    this.outbox.clear();
    this.tracked = new WeakMap();
    clearAll(this.doc);
  }

  resetPageStats(): void {
    this.seen.clear();
    this.judol.clear();
    this.suspicious.clear();
    this.setRevealAll(false);
  }

  // ---------- DOM intake ----------

  private onMutations(records: MutationRecord[]): void {
    for (const r of records) {
      if (r.type === "characterData") {
        if (!isOurs(r.target)) this.dirty.add(r.target);
        continue;
      }
      if (isOurs(r.target)) continue;
      for (const n of r.addedNodes) if (!isOurs(n)) this.dirty.add(n);
      for (const n of r.removedNodes) {
        if (!(n instanceof Element && n.classList.contains("aj-badge"))) {
          this.dirty.add(r.target);
          break;
        }
      }
    }
    // MutationObserver callbacks run as microtasks before the next paint, so doing the first
    // slice here means strong hits are blurred before they are ever rendered.
    this.flush();
  }

  private flush(): void {
    if (!this.cfg?.active || !this.set || this.dirty.size === 0) return;
    const containers = this.set.containers;
    const t0 = this.now();
    const found = new Set<Element>();
    for (const n of this.dirty) {
      const el = n.nodeType === 1 ? (n as Element) : n.parentElement;
      if (!el) continue;
      const c = el.closest(containers);
      if (c) found.add(c);
      if (n.nodeType === 1) for (const x of el.querySelectorAll(containers)) found.add(x);
    }
    this.dirty.clear();

    let i = 0;
    let over = false;
    for (const el of found) {
      if (!over && (i & 7) === 7 && this.now() - t0 > SLICE_BUDGET_MS) over = true;
      if (over) this.dirty.add(el);
      else {
        this.process(el);
        i++;
      }
    }
    const dt = this.now() - t0;
    this.perf.slices++;
    this.perf.items += i;
    this.perf.totalMs += dt;
    if (dt > this.perf.maxSliceMs) this.perf.maxSliceMs = dt;

    if (this.dirty.size > 0 && this.sliceTimer === undefined) {
      this.sliceTimer = setTimeout(() => {
        this.sliceTimer = undefined;
        this.flush();
      }, 0);
    }
  }

  private process(el: Element): void {
    const cfg = this.cfg;
    const a = this.set ? adapterFor(el, this.set) : undefined;
    if (!cfg || !a) return;
    const prev = this.tracked.get(el);
    if (!cfg.surfaces[a.surface]) {
      if (prev) this.detach(el, prev);
      return;
    }
    const { text, author } = extract(el, a);
    const raw = `${author}\u0000${text}`;
    if (prev?.raw === raw) return; // unchanged (e.g. our own badge insertion)
    if (prev) this.detach(el, prev); // recycled node (YouTube reuses renderers)
    if (text.length < 2) return;

    const n = normalize(text);
    const na = author ? normalize(author) : null;
    const cv = customVerdict(n, this.custom) ?? (na ? customVerdict(na, this.custom) : null);
    if (cv === "allow") return; // user said these words are never judol
    const score = cv === "block" ? 1 : Math.max(scoreLocal(n).score, na ? scoreLocal(na).score * 0.9 : 0);
    const key = hashKey(`${n.key}|${na?.key ?? ""}`);
    const tr: Track = { raw, origText: text, origAuthor: author, key, surface: a.surface, score, text: n.display, author: na?.display ?? "" };
    this.tracked.set(el, tr);
    this.seen.add(key);
    this.decide(el, tr);
  }

  private detach(el: Element, tr: Track): void {
    this.tracked.delete(el);
    this.waiting.get(tr.key)?.delete(el);
    this.io?.unobserve(el);
    clearMark(el);
  }

  private decide(el: Element, tr: Track): void {
    const cfg = this.cfg!;
    if (this.allow.has(tr.key)) return this.mark(el, tr, { key: tr.key, verdict: Verdict.SAFE, source: "user", pJudol: 0 });
    const known = this.verdicts.get(tr.key);
    if (known) return this.mark(el, tr, known);

    if (!cfg.jevAvailable) {
      const verdict = localVerdict(tr.score, cfg.sensitivity);
      return this.mark(el, tr, { key: tr.key, verdict, source: "local", pJudol: tr.score });
    }

    // Provisional mark while Jev decides.
    const t = THRESHOLDS[cfg.sensitivity];
    if (tr.score >= t.localInstant) this.mark(el, tr, { key: tr.key, verdict: Verdict.JUDOL_PROMO, source: "local", pJudol: tr.score });
    else if (cfg.preblurLocal && cfg.action !== "badge" && tr.score >= t.localSuspect) this.paint(el, tr, "pending", "local");

    let set = this.waiting.get(tr.key);
    if (!set) this.waiting.set(tr.key, (set = new Set()));
    set.add(el);

    if (tr.surface === "live_chat" || tr.score >= t.localSuspect || !this.io) this.enqueue(tr, 1);
    else this.io.observe(el);
  }

  private onVisible(entries: IntersectionObserverEntry[]): void {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      this.io?.unobserve(e.target);
      const tr = this.tracked.get(e.target);
      if (tr && !this.verdicts.has(tr.key)) this.enqueue(tr, e.intersectionRatio > 0 ? 1 : 0);
    }
  }

  // ---------- classify outbox ----------

  private enqueue(tr: Track, boost: number): void {
    const priority = PRIORITY[tr.surface] + boost + tr.score;
    const existing = this.outbox.get(tr.key);
    if (existing) {
      existing.priority = Math.max(existing.priority, priority);
    } else {
      const item: ClassifyItem = { key: tr.key, surface: tr.surface, text: tr.text, localScore: tr.score, priority };
      if (this.set) item.platform = this.set.platform;
      if (tr.author) item.author = tr.author;
      this.outbox.set(tr.key, item);
    }
    this.scheduleSend();
  }

  private scheduleSend(): void {
    if (this.sendTimer !== undefined || this.outbox.size === 0 || this.inflight >= MAX_INFLIGHT) return;
    this.sendTimer = setTimeout(
      () => {
        this.sendTimer = undefined;
        void this.send();
      },
      this.outbox.size >= SEND_MAX ? 0 : SEND_WINDOW_MS,
    );
  }

  private async send(): Promise<void> {
    const batch = [...this.outbox.values()].sort((a, b) => b.priority - a.priority).slice(0, SEND_MAX);
    for (const it of batch) this.outbox.delete(it.key);
    this.inflight++;
    let results: ClassifyResult[];
    try {
      results = await this.d.classify(batch);
    } catch {
      // Extension reloaded / worker unavailable: degrade to local verdicts.
      const sens = this.cfg?.sensitivity ?? "normal";
      results = batch.map((it) => ({ key: it.key, verdict: localVerdict(it.localScore, sens), source: "local", pJudol: it.localScore }));
    } finally {
      this.inflight--;
    }
    for (const r of results) this.resolve(r);
    this.scheduleSend();
  }

  private resolve(r: ClassifyResult): void {
    if (r.source !== "local") {
      this.verdicts.set(r.key, r);
      if (this.verdicts.size > MAX_VERDICTS) {
        const oldest = this.verdicts.keys().next().value;
        if (oldest !== undefined) this.verdicts.delete(oldest);
      }
    }
    const els = this.waiting.get(r.key);
    this.waiting.delete(r.key);
    if (!els) return;
    for (const el of els) {
      const tr = this.tracked.get(el);
      if (tr?.key === r.key) this.mark(el, tr, r);
    }
  }

  // ---------- marking ----------

  private mark(el: Element, tr: Track, r: ClassifyResult): void {
    if (r.verdict === Verdict.SAFE) {
      this.judol.delete(tr.key);
      this.suspicious.delete(tr.key);
      clearMark(el);
      return;
    }
    const judol = r.verdict === Verdict.JUDOL_PROMO;
    (judol ? this.judol : this.suspicious).add(tr.key);
    (judol ? this.suspicious : this.judol).delete(tr.key);
    this.paint(el, tr, judol ? "judol" : "suspicious", r.source);
  }

  private paint(el: Element, tr: Track, state: MarkState, source: ClassifyResult["source"]): void {
    const cfg = this.cfg!;
    const action = state === "suspicious" && !cfg.blurSuspicious ? "badge" : cfg.action;
    applyMark(el, { state, action, key: tr.key, source });
  }

  private allowKey(key: string, el: Element): void {
    this.allow.add(key);
    this.judol.delete(key);
    this.suspicious.delete(key);
    this.verdicts.set(key, { key, verdict: Verdict.SAFE, source: "user", pJudol: 0 });
    clearMark(el);
    for (const other of this.doc.querySelectorAll(`[data-aj-key="${CSS.escape(key)}"]`)) clearMark(other);
    this.d.onAllow(key);
  }

  /** Drop references to nodes YouTube removed (long live-chat sessions). */
  private sweep(): void {
    for (const [key, els] of this.waiting) {
      for (const el of els) if (!el.isConnected) els.delete(el);
      if (els.size === 0) this.waiting.delete(key);
    }
  }
}
