/**
 * Daily cost guard: counts comments sent to the classifier API per local day.
 * When the limit is hit, the scheduler falls back to local verdicts until midnight.
 */
export interface UsageSnapshot {
  day: string;
  items: number;
}

export function localDay(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export class DailyQuota {
  private day: string;
  private items = 0;

  constructor(
    private readonly limit: () => number,
    private readonly now: () => number = Date.now,
  ) {
    this.day = localDay(this.now());
  }

  private roll(): void {
    const today = localDay(this.now());
    if (today !== this.day) {
      this.day = today;
      this.items = 0;
    }
  }

  /** True while under the limit (0 = unlimited). */
  get available(): boolean {
    this.roll();
    const max = this.limit();
    return max === 0 || this.items < max;
  }

  consume(n: number): void {
    this.roll();
    this.items += n;
  }

  get used(): number {
    this.roll();
    return this.items;
  }

  snapshot(): UsageSnapshot {
    this.roll();
    return { day: this.day, items: this.items };
  }

  load(raw: unknown): void {
    const r = raw as Partial<UsageSnapshot> | null;
    if (r && typeof r.day === "string" && typeof r.items === "number" && r.day === localDay(this.now())) {
      this.day = r.day;
      this.items = Math.max(0, r.items);
    }
  }
}
