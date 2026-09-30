/**
 * Turning scores into verdicts happens in code, not in the model: Jev returns
 * probabilities, and thresholds (tuned by sensitivity) plus the local score decide.
 */
import type { Sensitivity } from "./settings";
import { Verdict, type VerdictProbs } from "./verdict";

export interface Thresholds {
  /** Local score at/above which we blur instantly (before Jev answers). */
  localInstant: number;
  /** Local score at/above which we pre-blur as "pending" while Jev is asked. */
  localSuspect: number;
  /** P(JUDOL_PROMO) needed for a JUDOL verdict. */
  jevJudol: number;
  /** P(JUDOL_PROMO)+P(SUSPICIOUS_SPAM) needed for a SUSPICIOUS verdict. */
  jevSuspicious: number;
}

export const THRESHOLDS: Record<Sensitivity, Thresholds> = {
  low: { localInstant: 0.95, localSuspect: 0.7, jevJudol: 0.7, jevSuspicious: 0.8 },
  normal: { localInstant: 0.85, localSuspect: 0.5, jevJudol: 0.5, jevSuspicious: 0.6 },
  high: { localInstant: 0.75, localSuspect: 0.35, jevJudol: 0.35, jevSuspicious: 0.45 },
};

/** Verdict when Jev is unavailable (no key, offline, circuit open). */
export function localVerdict(score: number, sens: Sensitivity): Verdict {
  const t = THRESHOLDS[sens];
  if (score >= t.localInstant) return Verdict.JUDOL_PROMO;
  if (score >= t.localSuspect + 0.1) return Verdict.SUSPICIOUS_SPAM;
  return Verdict.SAFE;
}

/** Final verdict from Jev probabilities, lightly blended with the local score. */
export function combine(p: VerdictProbs, localScore: number, sens: Sensitivity): Verdict {
  const t = THRESHOLDS[sens];
  const pj = p.JUDOL_PROMO;
  if (pj >= t.jevJudol) return Verdict.JUDOL_PROMO;
  // Strong obfuscated-brand evidence + moderate model belief → still judol.
  if (localScore >= t.localInstant && pj >= t.jevJudol / 2) return Verdict.JUDOL_PROMO;
  if (pj + p.SUSPICIOUS_SPAM >= t.jevSuspicious) return Verdict.SUSPICIOUS_SPAM;
  return Verdict.SAFE;
}
