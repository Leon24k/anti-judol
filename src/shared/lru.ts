/** Small LRU cache with TTL, built on Map insertion order. */
export class LruCache<V> {
  private readonly map = new Map<string, { v: V; exp: number }>();

  constructor(
    private readonly max: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    return this.map.size;
  }

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.exp <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh recency.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.v;
  }

  set(key: string, v: V, exp = this.now() + this.ttlMs): void {
    this.map.delete(key);
    this.map.set(key, { v, exp });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  /** Serializable snapshot (oldest → newest), skipping expired entries. */
  dump(): Array<[string, V, number]> {
    const t = this.now();
    const out: Array<[string, V, number]> = [];
    for (const [k, { v, exp }] of this.map) if (exp > t) out.push([k, v, exp]);
    return out;
  }

  load(entries: ReadonlyArray<readonly [string, V, number]>): void {
    for (const [k, v, exp] of entries) this.set(k, v, exp);
  }
}
