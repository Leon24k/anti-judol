import { describe, expect, test } from "bun:test";
import { normalize } from "../src/shared/normalize";
import { scoreText } from "../src/shared/heuristics";
import { localVerdict } from "../src/shared/decide";

describe("normalize", () => {
  test.each([
    ["s l o t g4c0r", "slot gacor"],
    ["S.L.O.T gacor", "SLOT gacor"],
    ["ｓｌｏｔ　ｇａｃｏｒ", "slot gacor"],
    ["𝐉𝐔𝐃𝐈𝟖𝟖𝟖", "JUDI888"],
    ["ⓢⓛⓞⓣ", "slot"],
    ["🅹🆄🅳🅸", "JUDI"],
    ["g\u200ba\u200bc\u200bo\u200br", "gacor"],
    ["Ѕlоt gасоr", "Slot gacor"], // Cyrillic homoglyphs mixed with Latin
    ["m4xw1n", "maxwin"],
    ["kasino310 (dot) com", "kasino310.com"],
    ["gacor88 . com", "gacor88.com"],
    ["maxwiiiiiin", "maxwiin"],
    ["z̷a̷l̷g̷o̷", "zalgo"],
  ])("%p → %p", (input, expected) => {
    expect(normalize(input).display).toBe(expected);
  });

  test("keeps legitimate text readable", () => {
    expect(normalize("Aku nonton 2 hari, dapat 10rb views").display).toBe("Aku nonton 2 hari, dapat 10rb views");
    expect(normalize("Привет из Москвы").display).toBe("Привет из Москвы"); // real Cyrillic untouched
    expect(normalize("日本語のコメント 🎉").display).toBe("日本語のコメント 🎉");
    expect(normalize("Café très bon").display).toBe("Cafe tres bon");
  });

  test("same obfuscated text → same cache key", () => {
    expect(normalize("SLOT GACOR").key).toBe(normalize("s l o t g4c0r").key);
    expect(normalize("slot gacor").key).not.toBe(normalize("mantap bang").key);
  });

  test("obfuscation ratio", () => {
    expect(normalize("slot gacor").obfuscation).toBe(0);
    expect(normalize("ｓｌｏｔ ｇａｃｏｒ").obfuscation).toBeGreaterThan(0.6);
    expect(normalize("s l o t").obfuscation).toBeGreaterThan(0.5);
  });

  test("caps length", () => {
    expect(normalize("a b ".repeat(2000)).display.length).toBeLessThanOrEqual(500);
  });
});

describe("local heuristics", () => {
  const judol = [
    "s l o t g4c0r hari ini, cek bio 🔥",
    "𝐉𝐔𝐃𝐈𝟖𝟖𝟖 maxwiiiin wd 10rb",
    "kasino310 (dot) com depo 10rb",
    "Situs slot gacor maxwin, daftar sekarang di link bio",
    "ⓢⓛⓞⓣ ⓖⓐⓒⓞⓡ 🅹🆄🅳🅸",
    "Main di PULAU777 auto jp paus",
  ];
  const safe = [
    "Mantap videonya bang, lanjutkan!",
    "Aku suka lagu ini 2 hari nonton terus",
    "Tutorial masak nasi goreng yang enak",
    "First! Salam dari Bandung",
    "Parkir slot mobil di mall penuh terus",
  ];

  test.each(judol)("flags %p", (t) => {
    expect(localVerdict(scoreText(t).score, "normal")).not.toBe("SAFE");
  });

  test.each(safe)("passes %p", (t) => {
    expect(localVerdict(scoreText(t).score, "normal")).toBe("SAFE");
  });

  test("anti-gambling news is dampened", () => {
    const news = scoreText("Berita: polisi tangkap bandar judi online").score;
    const promo = scoreText("bandar judi online terpercaya, daftar sekarang").score;
    expect(news).toBeLessThan(promo);
    expect(localVerdict(news, "normal")).toBe("SAFE");
  });

  test("is fast: 1000 comments < 50ms", () => {
    const texts = Array.from({ length: 1000 }, (_, i) => `${judol[i % judol.length]} ${safe[i % safe.length]} #${i}`);
    const t0 = performance.now();
    for (const t of texts) scoreText(t);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
