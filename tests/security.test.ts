import { describe, expect, test } from "bun:test";
import { endpointsFor } from "../src/background/jev";
import { DailyQuota } from "../src/background/quota";
import { DEFAULT_SETTINGS, jevConfigured, maskKey, sanitizeSettings } from "../src/shared/settings";

describe("safety defaults", () => {
  test("nothing is sent without explicit consent, even with a key", () => {
    expect(DEFAULT_SETTINGS.remoteConsent).toBe(false);
    expect(jevConfigured({ ...DEFAULT_SETTINGS, apiKey: "k" })).toBe(false);
    expect(jevConfigured({ ...DEFAULT_SETTINGS, apiKey: "k", remoteConsent: true })).toBe(true);
    expect(jevConfigured({ ...DEFAULT_SETTINGS, remoteConsent: true })).toBe(false);
  });

  test("keys can only go to the fixed TypeSafe / OpenRouter hosts", () => {
    const s = sanitizeSettings({ apiKey: "a", openrouterKey: "b", endpoint: "https://evil.example", remoteConsent: true });
    expect("endpoint" in s).toBe(false);
    const hosts = endpointsFor(s).map((e) => new URL(e.url).host);
    expect(hosts).toEqual(["api.typesafe.ai", "openrouter.ai"]);
  });

  test("sanitizer rejects junk", () => {
    const s = sanitizeSettings({ model: "x\"; drop", dailyLimit: -5, action: "explode", remoteConsent: "yes" });
    expect(s.model).toBe("");
    expect(s.dailyLimit).toBe(0);
    expect(s.action).toBe("blur");
    expect(s.remoteConsent).toBe(false);
    expect(sanitizeSettings({ dailyLimit: 1e12 }).dailyLimit).toBe(1_000_000);
  });

  test("masked key never reveals the secret", () => {
    expect(maskKey("apikey_secret_abcd")).toBe("…abcd");
    expect(maskKey("")).toBeNull();
  });
});

describe("daily quota", () => {
  test("blocks after limit and resets next day", () => {
    let now = new Date(2026, 8, 30, 23, 59).getTime();
    const q = new DailyQuota(() => 10, () => now);
    q.consume(9);
    expect(q.available).toBe(true);
    q.consume(1);
    expect(q.available).toBe(false);
    now += 2 * 60_000; // past midnight
    expect(q.available).toBe(true);
    expect(q.used).toBe(0);
  });

  test("0 = unlimited; stale snapshot ignored", () => {
    const q = new DailyQuota(() => 0);
    q.consume(1e6);
    expect(q.available).toBe(true);
    const r = new DailyQuota(() => 5);
    r.load({ day: "2000-01-01", items: 99 });
    expect(r.used).toBe(0);
  });
});

describe("message privileges", () => {
  test("content scripts can only send the four page-safe messages", async () => {
    const { PRIVILEGED } = await import("../src/shared/messages");
    const src = await Bun.file("src/shared/messages.ts").text();
    const bg = src.slice(src.indexOf("export interface BgMessages"), src.indexOf("export type BgType"));
    const all = [...bg.matchAll(/^\s+"?([a-z]+(?::[A-Za-z]+)?)"?: \{ req:/gm)].map((m) => m[1]!);
    expect(all.length).toBeGreaterThan(15);
    const open = all.filter((t) => !PRIVILEGED.has(t as never)).sort();
    expect(open).toEqual(["block:check", "classify", "rule:allow", "state:get"]);
  });
});
