/**
 * On-device heuristic tier. Runs synchronously in the content script so strong hits can be
 * blurred on the very next frame (well under 50ms), before Jev answers.
 * It is intentionally a *scorer*, not a blocklist: Jev has the final say when available.
 */
import { normalize, skeletonOf, type Normalized } from "./normalize";

type Mode = "word" | "prefix" | "sub" | "joined";
interface Rule {
  id: string;
  kw: string;
  w: number;
  mode: Mode;
  group: "core" | "promo" | "anti";
}

function rules(group: Rule["group"], w: number, mode: Mode, list: string[]): Rule[] {
  return list.map((raw) => ({ id: raw, kw: skeletonOf(raw), w, mode, group }));
}

const RULES: Rule[] = [
  // Unambiguous gambling vocabulary.
  ...rules("core", 0.6, "joined", [
    "gacor", "maxwin", "togel", "judol", "judi online", "slot online", "slot gacor", "kasino", "casino",
    "sbobet", "mix parlay", "scatter", "rungkad", "mahjong ways", "gates of olympus", "pragmatic play",
    "bandar togel", "situs slot",
  ]),
  // Gambling-related but ambiguous alone.
  ...rules("core", 0.3, "prefix", ["slot", "judi", "jackpot", "taruhan", "poker", "olympus", "zeus", "parlay", "toto"]),
  ...rules("core", 0.3, "word", ["jp", "rtp", "bet", "betting", "bandar", "pragmatic", "spin", "x500", "x1000"]),
  // Promotion / call-to-action vocabulary.
  ...rules("promo", 0.2, "prefix", ["depo", "deposit", "withdraw", "bonus", "daftar", "alternatif", "situs", "klaim", "promo"]),
  ...rules("promo", 0.2, "word", [
    "wd", "member", "link", "bio", "pola", "cuan", "menang", "gampang", "modal", "receh", "gratis", "login", "admin",
  ]),
  // Anti-gambling / news context (dampens local score; Jev decides nuanced cases).
  ...rules("anti", 0, "prefix", [
    "berita", "bahaya", "hindari", "larang", "berantas", "tangkap", "polisi", "kominfo", "komdigi", "haram",
    "kecanduan", "korban", "jangan", "stop", "tolak", "blokir", "hancur", "bangkrut",
  ]),
];

const BRAND_TOKEN = /^(?:[a-z]{3,}\d{2,}[a-z]*|\d{2,}[a-z]{3,}\d*)$/; // judi888, kasino310, 88slot
const DOMAIN =
  /\b[a-z0-9][a-z0-9-]{1,40}\.(?:com|net|org|xyz|site|online|vip|top|id|co|me|io|bet|club|link|pro|live|win|asia|fun|icu|shop|cc|info|biz)\b|\bt\.me\/|\bwa\.me\/|\bbit\.ly\//i;

export interface LocalScore {
  score: number; // 0..1, noisy-OR of signals
  signals: string[];
}

export function scoreLocal(n: Normalized): LocalScore {
  const signals: string[] = [];
  const weights: number[] = [];
  let core = false;
  let promoHits = 0;
  let anti = false;

  const add = (id: string, w: number) => {
    signals.push(id);
    weights.push(w);
  };

  for (const r of RULES) {
    let hit = false;
    switch (r.mode) {
      case "joined":
        hit = n.joined.includes(r.kw);
        break;
      case "word":
        hit = n.words.includes(r.kw);
        break;
      case "prefix":
        hit = n.words.some((w) => w.startsWith(r.kw));
        break;
      case "sub":
        hit = n.words.some((w) => w.includes(r.kw));
        break;
    }
    if (!hit) continue;
    if (r.group === "anti") {
      anti = true;
      signals.push(`anti:${r.id}`);
      continue;
    }
    if (r.group === "promo") {
      if (promoHits >= 2) continue; // cap promo contribution
      promoHits++;
    } else core = true;
    add(r.id, r.w);
  }

  let brand = false;
  for (const w of n.words) {
    if (!BRAND_TOKEN.test(w)) continue;
    brand = true;
    add(`brand:${w}`, 0.45);
    if (RULES.some((r) => r.group === "core" && w.includes(r.kw))) add("brand+core", 0.5);
    break;
  }

  const domain = DOMAIN.test(n.display);
  if (domain) add("domain", 0.35);

  if (n.obfuscation >= 0.6 && n.joined.length >= 6) add("obfuscated:heavy", 0.5);
  else if (n.obfuscation >= 0.25 && n.joined.length >= 6) add("obfuscated", 0.35);

  if (core && (promoHits > 0 || brand || domain)) add("core+promo", 0.4);

  let keep = 1;
  for (const w of weights) keep *= 1 - w;
  let score = 1 - keep;
  // Commentary *about* judol without any promo signal is probably not promotion.
  if (anti && promoHits === 0 && !brand && !domain) score *= 0.5;

  return { score, signals };
}

/** Convenience for tests / callers that only have raw text. */
export function scoreText(text: string): LocalScore {
  return scoreLocal(normalize(text));
}
