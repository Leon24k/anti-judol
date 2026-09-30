/**
 * Batching scheduler in the service worker (shared by all tabs/frames).
 *
 *  cache hit ──────────────► answer immediately
 *  in-flight same key ─────► share the pending promise (dedupe across tabs/frames)
 *  otherwise ──────────────► priority queue → coalescing window (30ms) or full batch (24)
 *                            → ≤3 concurrent requests, ≥100ms apart (token pacing)
 *  429/529/5xx ────────────► pause queue with exponential backoff + jitter (honours Retry-After)
 *  401/403 ────────────────► circuit open 5 min, everything falls back to local verdicts
 *  queue > maxQueue ───────► lowest-priority items resolved locally (backpressure)
 */
import { combine, localVerdict } from "../shared/decide";
import { LruCache } from "../shared/lru";
import type { ClassifyItem, ClassifyResult, JevStatus } from "../shared/messages";
import type { Sensitivity } from "../shared/settings";
import type { VerdictProbs } from "../shared/verdict";
import { JevError } from "./jev";

export interface SchedulerDeps {
  send(items: ClassifyItem[]): Promise<Array<VerdictProbs | undefined>>;
  available(): boolean;
  sensitivity(): Sensitivity;
  onStatus?(s: JevStatus): void;
  now?(): number;
}

export interface SchedulerOpts {
  maxBatch: number;
  windowMs: number;
  concurrency: number;
  minIntervalMs: number;
  maxQueue: number;
  maxAttempts: number;
  /** Local score at/above which Jev is not consulted at all (saves quota). */
  skipJevAbove: number;
}

export const DEFAULT_OPTS: SchedulerOpts = {
  maxBatch: 24,
  windowMs: 30,
  concurrency: 3,
  minIntervalMs: 100,
  maxQueue: 400,
  maxAttempts: 3,
  skipJevAbove: 0.97,
};

interface Pending {
  item: ClassifyItem;
  attempts: number;
  resolve(r: ClassifyResult): void;
}

export class Scheduler {
  readonly cache = new LruCache<VerdictProbs>(5000, 7 * 24 * 3600_000);
  private readonly o: SchedulerOpts;
  private readonly now: () => number;
  private queue: Pending[] = [];
  private inflight = new Map<string, Promise<ClassifyResult>>();
  private active = 0;
  private lastSent = -Infinity;
  private pausedUntil = 0;
  private circuitUntil = 0;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Stats for the popup / tests. */
  readonly stats = { requests: 0, items: 0, cacheHits: 0, local: 0, errors: 0 };

  constructor(
    private readonly d: SchedulerDeps,
    opts: Partial<SchedulerOpts> = {},
  ) {
    this.o = { ...DEFAULT_OPTS, ...opts };
    this.now = d.now ?? Date.now;
  }

  classify(items: readonly ClassifyItem[]): Promise<ClassifyResult[]> {
    return Promise.all(items.map((it) => this.one(it)));
  }

  private one(item: ClassifyItem): Promise<ClassifyResult> {
    const sens = this.d.sensitivity();
    const cached = this.cache.get(item.key);
    if (cached) {
      this.stats.cacheHits++;
      return Promise.resolve(this.fromProbs(item, cached, "cache", sens));
    }
    if (!this.jevUsable() || item.localScore >= this.o.skipJevAbove || item.text.length < 3) {
      return Promise.resolve(this.local(item));
    }
    const existing = this.inflight.get(item.key);
    if (existing) return existing;

    const p = new Promise<ClassifyResult>((resolve) => {
      this.queue.push({ item, attempts: 0, resolve });
    }).finally(() => this.inflight.delete(item.key));
    this.inflight.set(item.key, p);
    this.enforceQueueLimit();
    this.schedule();
    return p;
  }

  private jevUsable(): boolean {
    return this.d.available() && this.now() >= this.circuitUntil;
  }

  private local(item: ClassifyItem): ClassifyResult {
    this.stats.local++;
    return { key: item.key, verdict: localVerdict(item.localScore, this.d.sensitivity()), source: "local", pJudol: item.localScore };
  }

  private fromProbs(item: ClassifyItem, p: VerdictProbs, source: "jev" | "cache", sens: Sensitivity): ClassifyResult {
    return { key: item.key, verdict: combine(p, item.localScore, sens), source, pJudol: p.JUDOL_PROMO };
  }

  private enforceQueueLimit(): void {
    if (this.queue.length <= this.o.maxQueue) return;
    this.queue.sort((a, b) => b.item.priority - a.item.priority);
    for (const dropped of this.queue.splice(this.o.maxQueue)) dropped.resolve(this.local(dropped.item));
  }

  /** Arm the coalescing timer, or pump now if a full batch is ready. */
  private schedule(delay?: number): void {
    if (this.queue.length === 0) return;
    const wait = delay ?? (this.queue.length >= this.o.maxBatch ? 0 : this.o.windowMs);
    if (this.timer !== undefined) {
      if (wait > 0) return; // already armed
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.pump();
    }, wait);
  }

  private pump(): void {
    const t = this.now();
    if (!this.jevUsable()) {
      for (const p of this.queue.splice(0)) p.resolve(this.local(p.item));
      return;
    }
    while (this.queue.length > 0 && this.active < this.o.concurrency) {
      const gate = Math.max(this.pausedUntil, this.lastSent + this.o.minIntervalMs);
      if (t < gate) return this.schedule(gate - t);
      this.queue.sort((a, b) => b.item.priority - a.item.priority);
      const batch = this.queue.splice(0, this.o.maxBatch);
      this.lastSent = t;
      void this.run(batch);
    }
  }

  private async run(batch: Pending[]): Promise<void> {
    this.active++;
    this.stats.requests++;
    this.stats.items += batch.length;
    const t0 = this.now();
    try {
      const probs = await this.d.send(batch.map((p) => p.item));
      this.failures = 0;
      this.d.onStatus?.({ state: "ok", latencyMs: this.now() - t0 });
      const sens = this.d.sensitivity();
      batch.forEach((p, i) => {
        const pr = probs[i];
        if (!pr) return p.resolve(this.local(p.item));
        this.cache.set(p.item.key, pr);
        p.resolve(this.fromProbs(p.item, pr, "jev", sens));
      });
    } catch (e) {
      this.stats.errors++;
      this.onError(e, batch);
    } finally {
      this.active--;
      this.schedule(0);
    }
  }

  private onError(e: unknown, batch: Pending[]): void {
    const err = e instanceof JevError ? e : new JevError(String(e), 0);
    const t = this.now();
    if (err.status === 401 || err.status === 403) {
      this.circuitUntil = t + 5 * 60_000;
      this.d.onStatus?.({ state: "unauthorized", at: t });
      for (const p of [...batch, ...this.queue.splice(0)]) p.resolve(this.local(p.item));
      return;
    }
    this.d.onStatus?.({ state: "error", message: err.message, at: t });
    if (!err.retryable) {
      for (const p of batch) p.resolve(this.local(p.item));
      return;
    }
    this.failures++;
    const backoff = Math.min(30_000, 500 * 2 ** (this.failures - 1)) * (0.8 + Math.random() * 0.4);
    this.pausedUntil = t + Math.max(backoff, err.retryAfterMs ?? 0);
    for (const p of batch) {
      if (++p.attempts >= this.o.maxAttempts) p.resolve(this.local(p.item));
      else this.queue.push(p);
    }
    this.enforceQueueLimit();
  }

  /** Reset circuit/backoff (e.g. after the user changes the API key). */
  reset(): void {
    this.circuitUntil = 0;
    this.pausedUntil = 0;
    this.failures = 0;
  }
}
