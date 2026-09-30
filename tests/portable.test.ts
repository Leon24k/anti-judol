import { describe, expect, test } from "bun:test";
import { Scanner } from "../src/content/scanner";
import { compileCustom, customVerdict } from "../src/shared/heuristics";
import type { ContentConfig } from "../src/shared/messages";
import { normalize } from "../src/shared/normalize";
import { PLATFORMS, type PlatformId } from "../src/shared/platforms";
import { decodeSync, encodeSync, fromPortable, mergeAllow, SYNC_CHUNK, toPortable } from "../src/shared/portable";
import { DEFAULT_RULES, DEFAULT_SETTINGS, sanitizeSettings } from "../src/shared/settings";

const SECRET = { ...DEFAULT_SETTINGS, apiKey: "apikey_SECRET_do_not_leak", openrouterKey: "sk-or-SECRET" };

describe("custom keywords", () => {
  const c = compileCustom(["gacor88", "Pulau Judi"], ["slot machine museum"]);
  test("block words match through obfuscation", () => {
    for (const t of ["main di g4c0r 88 sekarang", "𝐆𝐀𝐂𝐎𝐑𝟖𝟖 resmi", "PULAU  JUDI", "p u l a u judi"]) expect(customVerdict(normalize(t), c)).toBe("block");
  });
  test("allow words win; unrelated text → null", () => {
    expect(customVerdict(normalize("Slot machine museum di Makau, gacor88 banget"), c)).toBe("allow");
    expect(customVerdict(normalize("halo semua"), c)).toBeNull();
  });
  test("sanitized: trimmed, deduped, capped", () => {
    const s = sanitizeSettings({ customBlock: ["  a  ", "ok word", "ok word", 5, "x".repeat(100)], customAllow: "nope" });
    expect(s.customBlock).toEqual(["ok word", "x".repeat(60)]);
    expect(s.customAllow).toEqual([]);
  });

  const cfg = (over: Partial<ContentConfig>): ContentConfig => ({
    active: true, reason: "global", action: "blur", sensitivity: "normal", blurSuspicious: true, preblurLocal: true,
    surfaces: { comment: true, live_chat: true, video_title: true },
    platforms: Object.fromEntries(PLATFORMS.map((p) => [p.id, true])) as Record<PlatformId, boolean>,
    webScan: false, customBlock: [], customAllow: [], jevAvailable: false, allowKeys: [], ...over,
  });
  const comment = (text: string) => {
    const el = document.createElement("ytd-comment-view-model");
    const t = document.createElement("span");
    t.id = "content-text";
    t.textContent = text;
    el.append(t);
    return el;
  };

  test("scanner: custom block hides a comment the built-in filter would pass; allow unhides spam", async () => {
    const s = new Scanner(document, { classify: async () => [], onAllow: () => {} });
    document.body.innerHTML = "";
    s.start(cfg({ customBlock: ["cuanmania"], customAllow: ["gacor maxwin"] }));
    const a = comment("mampir ke CUANMANIA ya kak");
    const b = comment("slot gacor maxwin depo 10rb");
    document.body.append(a, b);
    await new Promise((r) => setTimeout(r, 60));
    expect(a.getAttribute("data-aj-state")).toBe("judol");
    expect(b.hasAttribute("data-aj-state")).toBe(false);
    s.stop();
  });
});

describe("export / import", () => {
  test("export never contains API keys", () => {
    const json = JSON.stringify(toPortable(SECRET, DEFAULT_RULES));
    expect(json).not.toContain("SECRET");
    expect(json).not.toContain("apiKey");
  });

  test("import keeps local keys, ignores keys in the file, validates", () => {
    const local = { ...SECRET };
    const file = { ...toPortable({ ...DEFAULT_SETTINGS, sensitivity: "high", customBlock: ["x88"] }, { ...DEFAULT_RULES, allow: { k1: 5 } }) };
    (file.settings as Record<string, unknown>).apiKey = "attacker-key";
    const r = fromPortable(file, local)!;
    expect(r.settings.apiKey).toBe(local.apiKey);
    expect(r.settings.openrouterKey).toBe(local.openrouterKey);
    expect(r.settings.sensitivity).toBe("high");
    expect(r.settings.customBlock).toEqual(["x88"]);
    expect(r.rules.allow).toEqual({ k1: 5 });
    expect(fromPortable({ app: "other" }, local)).toBeNull();
    expect(fromPortable("junk", local)).toBeNull();
  });

  test("whitelist merge keeps newest timestamps", () => {
    expect(mergeAllow({ a: 1, b: 5 }, { b: 3, c: 7 })).toEqual({ a: 1, b: 5, c: 7 });
  });
});

describe("chrome.storage.sync encoding", () => {
  test("round-trips across chunks within quota", () => {
    const allow = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`key${i}abcdefgh`, 1_700_000_000_000 + i]));
    const items = encodeSync(toPortable(DEFAULT_SETTINGS, { ...DEFAULT_RULES, allow }));
    const chunks = Object.entries(items).filter(([k]) => k !== "aj:s:n");
    expect(chunks.every(([, v]) => typeof v === "string" && v.length <= SYNC_CHUNK)).toBe(true);
    const total = chunks.reduce((n, [k, v]) => n + k.length + JSON.stringify(v).length, 0);
    expect(total).toBeLessThan(100_000);
    const back = decodeSync(items)!;
    expect(Object.keys(back.rules.allow).length).toBe(2000);
  });

  test("oversized whitelist is trimmed oldest-first to fit", () => {
    const allow = Object.fromEntries(Array.from({ length: 6000 }, (_, i) => [`k${i}-${"x".repeat(20)}`, i]));
    const back = decodeSync(encodeSync(toPortable(DEFAULT_SETTINGS, { ...DEFAULT_RULES, allow })))!;
    const kept = Object.values(back.rules.allow);
    expect(kept.length).toBeLessThan(6000);
    expect(Math.min(...kept)).toBeGreaterThan(0); // oldest dropped
    expect(kept).toContain(5999);
  });

  test("corrupt / partial sync data → null", () => {
    expect(decodeSync({})).toBeNull();
    expect(decodeSync({ "aj:s:n": 2, "aj:s:0": "{" })).toBeNull();
  });
});
