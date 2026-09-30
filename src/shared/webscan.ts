/**
 * Detection helpers for the all-sites scanner (ads, banners, injected links on ordinary sites).
 * Signals, strongest first:
 *   1. link / image / iframe points at a domain on the gambling blocklist (checked by the worker)
 *   2. the domain *name* itself looks like a judol site ("agenslots77", "slotgacor", "situsjudi")
 *   3. banner text: alt / title / aria-label / image file name ("banner-slot-gacor.gif")
 *   4. anchor text of injected SEO spam ("Slot Gacor Hari Ini")
 * Everything here is local; nothing leaves the device.
 */
import { cleanDomain, isProtected } from "./blocklist";
import { scoreText } from "./heuristics";

/** Distinctive gambling words: any occurrence inside a domain label is enough. */
const STRONG = ["gacor", "maxwin", "togel", "judol", "sbobet", "kasino", "casino", "taruhan", "parlay"];
/** Gambling words that also appear in normal names: need corroboration. */
const WEAK = ["slot", "slots", "judi", "toto", "poker", "bet", "betting", "jp", "spin", "zeus", "olympus", "mahjong", "pragmatic", "jackpot", "bandar", "hoki"];
/** Words that are typical of judol domain names specifically. */
const JUDOL_FILLER = ["agen", "situs", "daftar", "alternatif", "rtp", "pola", "raja", "dewa", "bos", "resmi", "terpercaya", "hk", "sgp", "sdy"];
/** Neutral words that only help split a label into words. */
const FILLER = ["online", "vip", "link", "login", "win", "max", "mega", "super", "gg", "king", "club", "id", "indo", "asia", "terbaik", "hari", "ini", "pro", "live", "net", "88", "77"];

const DICT = new Set([...STRONG, ...WEAK, ...JUDOL_FILLER, ...FILLER]);
const WEAK_SET = new Set(WEAK);
const JUDOL_FILLER_SET = new Set(JUDOL_FILLER);

/** Split `run` entirely into dictionary words (longest-first DP). null if impossible. */
function segment(run: string): string[] | null {
  const n = run.length;
  const best: Array<string[] | null> = Array(n + 1).fill(null);
  best[0] = [];
  for (let i = 0; i < n; i++) {
    const prev = best[i];
    if (!prev) continue;
    for (let j = Math.min(n, i + 12); j > i; j--) {
      const w = run.slice(i, j);
      if (DICT.has(w) && !best[j]) best[j] = [...prev, w];
    }
  }
  return best[n] ?? null;
}

/** Heuristic: does this host *name* look like a judol site? (Complements the blocklist.) */
export function hostLooksJudol(hostname: string): boolean {
  const host = cleanDomain(hostname);
  if (!host || isProtected(host)) return false;
  const labels = host.split(".");
  // Drop the TLD (and a second-level like .co.id / .or.id).
  const core = labels.slice(0, labels.length > 2 && labels.at(-2)!.length <= 3 ? -2 : -1);
  for (const label of core) {
    const hasDigits = /\d/.test(label);
    for (const run of label.split(/[^a-z]+/)) {
      if (run.length < 2) continue;
      if (STRONG.some((w) => run.includes(w))) return true;
      const words = segment(run);
      if (!words) continue;
      const gambling = words.filter((w) => WEAK_SET.has(w)).length;
      if (gambling === 0) continue;
      if (hasDigits || gambling >= 2 || words.some((w) => JUDOL_FILLER_SET.has(w))) return true;
    }
  }
  return false;
}

/** Readable text of a banner: alt/title/aria-label plus the image file name. */
export function bannerText(el: Element): string {
  const parts = [el.getAttribute("alt"), el.getAttribute("title"), el.getAttribute("aria-label")];
  const src = el.getAttribute("src") ?? el.getAttribute("data-src") ?? "";
  if (src && !src.startsWith("data:")) {
    try {
      const file = decodeURIComponent(new URL(src, "https://x.invalid/").pathname.split("/").pop() ?? "");
      parts.push(file.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[-_+.]+/g, " "));
    } catch {
      /* ignore */
    }
  }
  return parts.filter(Boolean).join(" ").slice(0, 300);
}

/** True if short promo text (banner alt, anchor text) is judol. */
export function textLooksJudol(text: string, threshold: number): boolean {
  const t = text.trim();
  return t.length >= 4 && scoreText(t).score >= threshold;
}

export function hostOf(url: string | null, base: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, base);
    return u.protocol === "http:" || u.protocol === "https:" ? cleanDomain(u.hostname) : null;
  } catch {
    return null;
  }
}
