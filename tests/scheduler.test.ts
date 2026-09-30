import { describe, expect, test } from "bun:test";
import { buildRequest, classifyWithFallback, endpointsFor, JevError, parseResponse, type FetchLike } from "../src/background/jev";
import { Scheduler } from "../src/background/scheduler";
import type { ClassifyItem } from "../src/shared/messages";
import { DEFAULT_SETTINGS } from "../src/shared/settings";
import type { VerdictProbs } from "../src/shared/verdict";

const P = (j: number, s = 0): VerdictProbs => ({ JUDOL_PROMO: j, SUSPICIOUS_SPAM: s, SAFE: 1 - j - s });
const item = (key: string, localScore = 0.2, priority = 1): ClassifyItem => ({
  key,
  surface: "comment",
  text: `text ${key}`,
  localScore,
  priority,
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("jev client", () => {
  test("one Choice question per item, text inside structured instructions", () => {
    const req = buildRequest([item("a"), { ...item("b"), author: "SLOT88" }], "jev-latest");
    expect(Object.keys(req.questions)).toEqual(["q0", "q1"]);
    const q1 = req.questions.q1 as { type: string; instructions: Record<string, string>; criteria: Record<string, string> };
    expect(q1.type).toBe("choice");
    expect(q1.instructions.text).toBe("text b");
    expect(q1.instructions.author).toBe("SLOT88");
    expect(Object.keys(q1.criteria).sort()).toEqual(["JUDOL_PROMO", "SAFE", "SUSPICIOUS_SPAM"]);
  });

  test("parseResponse validates + normalizes, missing answers → undefined", () => {
    const out = parseResponse(
      { answers: { q0: { probabilities: { JUDOL_PROMO: 2, SUSPICIOUS_SPAM: 1, SAFE: 1 } }, q1: { probabilities: { SAFE: "x" } } } },
      3,
    );
    expect(out[0]?.JUDOL_PROMO).toBeCloseTo(0.5);
    expect(out[1]).toBeUndefined();
    expect(out[2]).toBeUndefined();
  });

  test("endpoints: TypeSafe primary, OpenRouter only if key set", () => {
    expect(endpointsFor({ ...DEFAULT_SETTINGS, apiKey: "ts" }).map((e) => e.url)).toEqual(["https://api.typesafe.ai/v1/systemone"]);
    const both = endpointsFor({ ...DEFAULT_SETTINGS, apiKey: "ts", openrouterKey: "or" });
    expect(both.map((e) => e.url)).toEqual(["https://api.typesafe.ai/v1/systemone", "https://openrouter.ai/api/alpha/decisions"]);
    expect(both[1]?.headers.Authorization).toBe("Bearer or");
  });

  test("falls back to OpenRouter when TypeSafe is overloaded", async () => {
    const calls: string[] = [];
    const fetch: FetchLike = async (url) => {
      calls.push(url);
      if (url.includes("typesafe")) return new Response("busy", { status: 529 });
      return Response.json({ answers: { q0: { probabilities: { JUDOL_PROMO: 0.9, SUSPICIOUS_SPAM: 0.05, SAFE: 0.05 } } } });
    };
    const eps = endpointsFor({ ...DEFAULT_SETTINGS, apiKey: "ts", openrouterKey: "or" });
    const [p] = await classifyWithFallback([item("a")], eps, { fetch });
    expect(calls).toHaveLength(2);
    expect(p?.JUDOL_PROMO).toBeCloseTo(0.9);
  });
});

describe("scheduler", () => {
  function make(send: (n: number) => Promise<Array<VerdictProbs | undefined>> | Array<VerdictProbs | undefined>, opts = {}) {
    const batches: number[] = [];
    const s = new Scheduler(
      {
        send: async (items) => {
          batches.push(items.length);
          return send(items.length);
        },
        available: () => true,
        sensitivity: () => "normal",
      },
      { windowMs: 5, minIntervalMs: 0, ...opts },
    );
    return { s, batches };
  }

  test("coalesces many calls into few batches", async () => {
    const { s, batches } = make((n) => Array.from({ length: n }, () => P(0.9)));
    const all = await Promise.all(Array.from({ length: 50 }, (_, i) => s.classify([item(`k${i}`)])));
    expect(all.flat().every((r) => r.verdict === "JUDOL_PROMO" && r.source === "jev")).toBe(true);
    expect(batches.reduce((a, b) => a + b, 0)).toBe(50);
    expect(batches.length).toBeLessThanOrEqual(3); // 24 + 24 + 2
  });

  test("dedupes in-flight and caches results", async () => {
    const { s, batches } = make((n) => Array.from({ length: n }, () => P(0.05)));
    const [a, b] = await Promise.all([s.classify([item("same")]), s.classify([item("same")])]);
    expect(a[0]?.verdict).toBe("SAFE");
    expect(b[0]?.verdict).toBe("SAFE");
    expect(batches).toEqual([1]);
    const [c] = await s.classify([item("same")]);
    expect(c?.source).toBe("cache");
    expect(batches).toEqual([1]);
  });

  test("respects concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const { s } = make(async (n) => {
      peak = Math.max(peak, ++active);
      await sleep(15);
      active--;
      return Array.from({ length: n }, () => P(0.1));
    }, { maxBatch: 2, concurrency: 2 });
    await s.classify(Array.from({ length: 10 }, (_, i) => item(`c${i}`)));
    expect(peak).toBe(2);
  });

  test("retries on 429 then succeeds", async () => {
    let n = 0;
    const { s } = make((len) => {
      if (n++ === 0) throw new JevError("rate", 429, 10);
      return Array.from({ length: len }, () => P(0.8));
    });
    const [r] = await s.classify([item("r")]);
    expect(r?.source).toBe("jev");
    expect(n).toBe(2);
  });

  test("401 opens circuit → local verdicts, no more calls", async () => {
    const { s, batches } = make(() => {
      throw new JevError("nope", 401);
    });
    const [r] = await s.classify([item("x", 0.9)]);
    expect(r?.source).toBe("local");
    expect(r?.verdict).toBe("JUDOL_PROMO");
    await s.classify([item("y")]);
    expect(batches).toEqual([1]);
  });

  test("very strong local hits skip Jev", async () => {
    const { s, batches } = make(() => []);
    const [r] = await s.classify([item("strong", 0.99)]);
    expect(r?.verdict).toBe("JUDOL_PROMO");
    expect(batches).toEqual([]);
  });

  test("backpressure: overflow resolved locally, highest priority kept", async () => {
    const seen: number[] = [];
    const s = new Scheduler(
      { send: async (items) => (seen.push(...items.map((i) => i.priority)), items.map(() => P(0.1))), available: () => true, sensitivity: () => "normal" },
      { windowMs: 5, minIntervalMs: 0, maxQueue: 5 },
    );
    const res = await s.classify(Array.from({ length: 10 }, (_, i) => item(`b${i}`, 0.2, i)));
    expect(res.filter((r) => r.source === "local")).toHaveLength(5);
    expect(Math.min(...seen)).toBe(5);
  });
});
