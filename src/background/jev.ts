/**
 * Jev (TypeSafe System One) client.
 *
 * Batching strategy: ONE request carries N comments as N independent Choice questions
 * (Jev answers all questions of a request in parallel, so latency barely grows with N).
 * Each comment lives inside its own question's structured `instructions` object, so the
 * shared `state` stays tiny (just surface context) — Jev accuracy drops with large,
 * irrelevant state, and this keeps comment A from being a distractor for comment B.
 */
import type { ClassifyItem } from "../shared/messages";
import type { Settings, Surface } from "../shared/settings";
import { Verdict, VERDICTS, type VerdictProbs } from "../shared/verdict";

export const TYPESAFE_BASE = "https://api.typesafe.ai";
export const DEFAULT_MODEL = "jev-latest";

const SURFACE_LABEL: Record<Surface, string> = {
  comment: "a YouTube comment",
  live_chat: "a YouTube live chat message",
  video_title: "a YouTube video title",
};

/** Rubric. Written literally (Jev reads criteria at face value) with explicit boundary cases. */
export const CRITERIA: Record<Verdict, string> = {
  JUDOL_PROMO:
    "The text promotes or advertises online gambling (judi online / judol): slot sites, togel, casino, sports betting, " +
    "gambling brand names like 'name+digits' (e.g. judi888), words like gacor, maxwin, scatter, rungkad, jackpot, " +
    "deposit/withdraw (depo/wd) offers, bonuses, or invitations to register, visit a link, or check a bio to play. " +
    "Counts even when the spelling is disguised with spaces, symbols, digits, or fancy letters.",
  SUSPICIOUS_SPAM:
    "The text is spam or bot-like promotion that is not clearly gambling: scams, suspicious links or contact handles, " +
    "'check my profile/bio' bait, get-rich-quick or crypto/investment hype, or vague promotion that might hide gambling.",
  SAFE:
    "A normal message from a real viewer, including messages that discuss, joke about, criticize, warn against, " +
    "or report news about gambling without promoting it.",
};

const INSTRUCTION = "Classify `text`, which is {surface}. Is it promoting online gambling, other spam, or safe?";

export interface JevEndpoint {
  url: string;
  model: string;
  headers: Record<string, string>;
}

/** Endpoints are fixed (no user-configurable URL) so the API key can only ever go to these hosts. */
export function endpointFor(s: Settings): JevEndpoint {
  return {
    url: `${TYPESAFE_BASE}/v1/systemone`,
    model: s.model || DEFAULT_MODEL,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.apiKey}` },
  };
}

export const OPENROUTER_URL = "https://openrouter.ai/api/alpha/decisions";
export const OPENROUTER_MODEL = "typesafe/jev-1.13";

/** Ordered endpoint list: TypeSafe (your key) first, OpenRouter as optional paid fallback. */
export function endpointsFor(s: Settings): JevEndpoint[] {
  const out: JevEndpoint[] = [];
  if (s.apiKey) out.push(endpointFor(s));
  if (s.openrouterKey)
    out.push({
      url: OPENROUTER_URL,
      model: OPENROUTER_MODEL,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.openrouterKey}` },
    });
  return out;
}

/**
 * Try endpoints in order. Falls through on retryable errors (429/529/5xx/network) and auth
 * errors of the primary; the last endpoint's error is rethrown so the scheduler can back off.
 */
export async function classifyWithFallback(
  items: readonly JevItem[],
  eps: readonly JevEndpoint[],
  opts: { fetch?: FetchLike; timeoutMs?: number } = {},
): Promise<Array<VerdictProbs | undefined>> {
  let last: unknown = new JevError("no endpoint configured", 401);
  for (const ep of eps) {
    try {
      return await classifyBatch(items, ep, opts);
    } catch (e) {
      last = e;
      if (e instanceof JevError && e.status === 422) throw e; // bad request: another endpoint won't help
    }
  }
  throw last;
}

export type JevItem = Pick<ClassifyItem, "key" | "surface" | "text" | "author">;

export function buildRequest(items: readonly JevItem[], model: string) {
  const questions: Record<string, unknown> = {};
  items.forEach((it, i) => {
    const data: Record<string, string> = { text: it.text };
    // Author names like "SLOT GACOR 88" are a strong signal on YouTube.
    if (it.author) data.author = it.author;
    questions[`q${i}`] = {
      type: "choice",
      instructions: {
        ...data,
        question: INSTRUCTION.replace("{surface}", SURFACE_LABEL[it.surface]) + (it.author ? " `author` is the display name of the sender." : ""),
      },
      criteria: CRITERIA,
    };
  });
  return {
    model,
    state: {
      platform: "YouTube (mostly Indonesian-speaking audience)",
      task: "Moderation filter that hides online-gambling (judol) promotion from viewers.",
    },
    questions,
  };
}

export class JevError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Server-suggested retry delay, ms. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status === 529 || this.status >= 500;
  }
}

function toProbs(answer: unknown): VerdictProbs | undefined {
  if (!answer || typeof answer !== "object") return undefined;
  const p = (answer as { probabilities?: unknown }).probabilities;
  if (!p || typeof p !== "object") return undefined;
  const rec = p as Record<string, unknown>;
  const out = { SAFE: 0, JUDOL_PROMO: 0, SUSPICIOUS_SPAM: 0 } as VerdictProbs;
  let sum = 0;
  for (const v of VERDICTS) {
    const x = rec[v];
    if (typeof x !== "number" || !Number.isFinite(x) || x < 0) return undefined;
    out[v] = x;
    sum += x;
  }
  if (sum <= 0) return undefined;
  for (const v of VERDICTS) out[v] /= sum;
  return out;
}

export function parseResponse(body: unknown, count: number): Array<VerdictProbs | undefined> {
  const answers = (body as { answers?: unknown } | null)?.answers;
  const rec = answers && typeof answers === "object" ? (answers as Record<string, unknown>) : {};
  return Array.from({ length: count }, (_, i) => toProbs(rec[`q${i}`]));
}

function retryAfter(h: Headers): number | undefined {
  const v = h.get("retry-after");
  if (!v) return undefined;
  const secs = Number(v);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export async function classifyBatch(
  items: readonly JevItem[],
  ep: JevEndpoint,
  opts: { fetch?: FetchLike; timeoutMs?: number } = {},
): Promise<Array<VerdictProbs | undefined>> {
  const doFetch = opts.fetch ?? ((u, i) => fetch(u, i));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
  let res: Response;
  try {
    res = await doFetch(ep.url, {
      method: "POST",
      headers: ep.headers,
      body: JSON.stringify(buildRequest(items, ep.model)),
      signal: ctrl.signal,
      credentials: "omit",
      cache: "no-store",
    });
  } catch (e) {
    throw new JevError(ctrl.signal.aborted ? "timeout" : `network: ${(e as Error).message}`, 0);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      /* ignore */
    }
    throw new JevError(`HTTP ${res.status}${detail ? `: ${detail}` : ""}`, res.status, retryAfter(res.headers));
  }
  return parseResponse(await res.json(), items.length);
}

export const _test = { toProbs, INSTRUCTION };
export { Verdict };
