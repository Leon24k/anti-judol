/**
 * Type-safe verdict enum. Implemented as a const object + union type (rather than a TS `enum`)
 * so it survives `isolatedModules` / bundling and can be validated at runtime.
 */
export const Verdict = {
  SAFE: "SAFE",
  JUDOL_PROMO: "JUDOL_PROMO",
  SUSPICIOUS_SPAM: "SUSPICIOUS_SPAM",
} as const;

export type Verdict = (typeof Verdict)[keyof typeof Verdict];

export const VERDICTS: readonly Verdict[] = Object.values(Verdict);

export function isVerdict(x: unknown): x is Verdict {
  return typeof x === "string" && (VERDICTS as readonly string[]).includes(x);
}

/** Where a verdict came from. `local` = on-device heuristics, `jev` = Jev classifier. */
export type VerdictSource = "local" | "jev" | "cache" | "user";

/** Probability distribution over the three verdicts (sums to ~1). */
export type VerdictProbs = Record<Verdict, number>;
