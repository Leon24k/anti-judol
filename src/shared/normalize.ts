/**
 * Lightweight text sanitization pipeline (runs in the content script, <0.1ms per comment).
 *
 * Produces:
 *  - display:  readable, de-obfuscated text sent to Jev (fancy unicode → ASCII, zero-width removed,
 *              "s l o t" → "slot", "g4c0r" → "gacor", "(dot)" → ".").
 *  - words:    lowercase alnum tokens with repeated letters collapsed — word-level heuristics.
 *  - joined:   `words` with all separators removed — catches "ga-cor", "sl.ot" etc.
 *  - key:      stable cache key derived from `display`.
 *  - obfuscation: share of letters that needed de-obfuscation (itself a spam signal).
 */
import { hashKey } from "./hash";

export const MAX_LEN = 500;

export interface Normalized {
  display: string;
  words: string[];
  joined: string;
  key: string;
  obfuscation: number;
}

// Invisible / formatting characters abused to split keywords (ZWSP, ZWJ, bidi controls, Hangul filler, VS, tags…).
const INVISIBLE =
  /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]|\uDB40[\uDC00-\uDDEF]/gu;

const SMALL_CAPS: Record<string, string> = {
  ᴀ: "a", ʙ: "b", ᴄ: "c", ᴅ: "d", ᴇ: "e", ꜰ: "f", ɢ: "g", ʜ: "h", ɪ: "i", ᴊ: "j", ᴋ: "k", ʟ: "l",
  ᴍ: "m", ɴ: "n", ᴏ: "o", ᴘ: "p", ǫ: "q", ʀ: "r", ꜱ: "s", ᴛ: "t", ᴜ: "u", ᴠ: "v", ᴡ: "w", ʏ: "y", ᴢ: "z",
};

// Cyrillic / Greek letters that look like Latin ones.
const HOMOGLYPHS: Record<string, string> = {
  а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x",
  і: "i", ј: "j", ѕ: "s", ԁ: "d", ո: "n", ɡ: "g", ӏ: "l",
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", У: "Y", Х: "X",
  І: "I", Ј: "J", Ѕ: "S",
  α: "a", ε: "e", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x",
  Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Υ: "Y", Χ: "X",
};

const LEET: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "6": "g", "7": "t", "8": "b", "9": "g",
  "@": "a", $: "s", "!": "i", "|": "l", "€": "e",
};

const MARK = /\p{M}/u;
const MARKS = /\p{M}/gu;
const PRINTABLE_ASCII = /^[\x20-\x7E]+$/;
const LATIN = /[a-z]/i;
const CYR_GREEK = /[\u0370-\u03FF\u0400-\u04FF]/;

/** Per-character fold, memoized: fancy/fullwidth/math/circled/accented → ASCII. Returns [out, changed]. */
const foldMemo = new Map<string, string>();
function foldChar(ch: string): string {
  const hit = foldMemo.get(ch);
  if (hit !== undefined) return hit;
  let out = ch;
  const cp = ch.codePointAt(0) ?? 0;
  if (cp >= 0x1f150 && cp <= 0x1f169) out = String.fromCharCode(65 + cp - 0x1f150); // 🅐 negative circled
  else if (cp >= 0x1f170 && cp <= 0x1f189) out = String.fromCharCode(65 + cp - 0x1f170); // 🅰 negative squared
  else if (cp >= 0x1f1e6 && cp <= 0x1f1ff) out = String.fromCharCode(97 + cp - 0x1f1e6); // 🇸 regional indicator
  else if (SMALL_CAPS[ch]) out = SMALL_CAPS[ch];
  else if (MARK.test(ch)) out = ""; // stray combining mark (zalgo)
  else {
    const d = ch.normalize("NFKD").replace(MARKS, "");
    // Only accept folds that land in printable ASCII; keeps CJK/Hangul/emoji intact.
    if (d !== ch && d.length > 0 && PRINTABLE_ASCII.test(d)) out = d;
  }
  if (foldMemo.size < 20_000) foldMemo.set(ch, out);
  return out;
}

/** Collapse runs of ≥3 single characters split by separators: "s l o t", "S.L.O.T", "g-a-c-o-r". */
const SPACED = /(?<![\p{L}\p{N}])(?:[\p{L}\p{N}][\s._\-*·•|/\\+~]{1,3}){2,}[\p{L}\p{N}](?![\p{L}\p{N}])/gu;
const SPACED_SEP = /[\s._\-*·•|/\\+~]/gu;
const DOT_WORD = /\s*[[({]\s*(?:dot|titik)\s*[\])}]\s*/giu;
const DOT_SPACED = /(?<=[a-z0-9])\s+\.\s*(?=(?:com|net|org|xyz|site|online|vip|top|id|co|me|io|bet|club|link|pro|live|win|asia|fun|icu|shop)\b)/giu;
// Leet between letters ("g4c0r", "m4xw1n") or leading into ≥2 letters ("5lot").
const LEET_INNER = /(?<=\p{L})[013456789@$!|€]+(?=\p{L})/gu;
// Deliberately narrow ("5lot", "$lot", "@kun") so "10rb" / "2hari" stay intact.
const LEET_LEAD = /(?<![\p{L}\p{N}])[5@$](?=\p{L}{3,})/gu;
const REPEAT_LETTER_DISPLAY = /(\p{L})\1{2,}/gu;
const WS = /\s+/gu;

function deLeet(s: string): string {
  let out = "";
  for (const c of s) out += LEET[c] ?? c;
  return out;
}

export function normalize(input: string): Normalized {
  let changed = 0;
  let letters = 0;

  // 1) Strip invisibles + per-char fold (single pass).
  const raw = input.length > MAX_LEN * 2 ? input.slice(0, MAX_LEN * 2) : input;
  let s = "";
  for (const ch of raw.replace(INVISIBLE, () => {
    changed++;
    return "";
  })) {
    const code = ch.charCodeAt(0);
    if (code < 0x80) {
      s += ch;
      if ((code | 32) >= 97 && (code | 32) <= 122) letters++;
      continue;
    }
    const f = foldChar(ch);
    if (f !== ch) changed++;
    if (f.length > 0 && LATIN.test(f)) letters++;
    s += f;
  }

  // 2) Homoglyphs, only in tokens that mix Latin with Cyrillic/Greek (keeps real Russian/Greek text readable).
  s = s.replace(/\S+/gu, (tok) => {
    if (!CYR_GREEK.test(tok) || !LATIN.test(tok)) return tok;
    let out = "";
    for (const c of tok) {
      const m = HOMOGLYPHS[c];
      if (m) changed++;
      out += m ?? c;
    }
    return out;
  });

  // 3) Structural de-obfuscation.
  const count = (m: string, n = m.length) => {
    changed += n;
    return m;
  };
  s = s
    .replace(DOT_WORD, (m) => (count(m, 2), "."))
    .replace(DOT_SPACED, (m) => (count(m, 1), "."))
    .replace(SPACED, (m) => {
      const out = m.replace(SPACED_SEP, "");
      count(out);
      return out;
    })
    .replace(LEET_INNER, (m) => deLeet(count(m)))
    .replace(LEET_LEAD, (m) => deLeet(count(m)))
    .replace(REPEAT_LETTER_DISPLAY, "$1$1")
    .replace(WS, " ")
    .trim();

  const display = s.length > MAX_LEN ? s.slice(0, MAX_LEN) : s;

  // 4) Skeletons for heuristics.
  const lower = display.toLowerCase();
  let skel = "";
  for (const c of lower) skel += HOMOGLYPHS[c]?.toLowerCase() ?? c;
  const words = skel
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/([a-z])\1+/g, "$1")
    .split(" ")
    .filter(Boolean);
  const joined = words.join("");

  return {
    display,
    words,
    joined,
    key: hashKey(lower),
    obfuscation: letters === 0 ? 0 : Math.min(1, changed / letters),
  };
}

/** Skeleton transform for a keyword so lists stay consistent with `normalize().words`. */
export function skeletonOf(word: string): string {
  return normalize(word).joined;
}
