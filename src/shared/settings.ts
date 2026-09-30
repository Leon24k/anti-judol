/** Surfaces, settings, rules — plus runtime sanitizers so storage contents are always well-typed. */
import { cleanDomain } from "./blocklist";
import { PLATFORMS, type PlatformId } from "./platforms";

export type Surface = "comment" | "live_chat" | "video_title";
export const SURFACES: readonly Surface[] = ["comment", "live_chat", "video_title"];

export type Action = "blur" | "hide" | "badge";
export type Sensitivity = "low" | "normal" | "high";

export interface Settings {
  enabled: boolean;
  action: Action;
  sensitivity: Sensitivity;
  /** Blur SUSPICIOUS_SPAM too (otherwise badge only). */
  blurSuspicious: boolean;
  /** Pre-blur medium local-score items while Jev is thinking. */
  preblurLocal: boolean;
  surfaces: Record<Surface, boolean>;
  /** Per-platform switch. Non-YouTube platforms also need their host permission granted. */
  platforms: Record<PlatformId, boolean>;
  /** Your TypeSafe API key (stored only in chrome.storage.local, never sent to content scripts). */
  apiKey: string;
  /** Optional model override (default jev-latest). */
  model: string;
  /** Optional OpenRouter key, used only as fallback when TypeSafe fails (paid: ~$0.042/1M input tokens). */
  openrouterKey: string;
  /** User explicitly agreed that visible comment text is sent to the classifier API. */
  remoteConsent: boolean;
  /** Max comments sent to the API per day (cost guard). 0 = unlimited. */
  dailyLimit: number;
  /** User words/phrases: always treat as judol / never flag. Matched after de-obfuscation. */
  customBlock: string[];
  customAllow: string[];
  /** Opt-in: copy settings + whitelist (never API keys) via Chrome Sync. */
  syncEnabled: boolean;
  /** Opt-in: hide gambling banners/links on every website (needs <all_urls>). Local only. */
  webScan: boolean;
  /** Block navigation to known gambling domains (declarativeNetRequest). */
  blockSites: boolean;
  /** Use the community gambling-domain list (downloaded, no user data sent). */
  blockRemote: boolean;
  /** User's extra domains to block / never block. */
  blockDomains: string[];
  allowDomains: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  action: "blur",
  sensitivity: "normal",
  blurSuspicious: true,
  preblurLocal: true,
  surfaces: { comment: true, live_chat: true, video_title: true },
  platforms: Object.fromEntries(PLATFORMS.map((p) => [p.id, p.builtin])) as Record<PlatformId, boolean>,
  apiKey: "",
  model: "",
  openrouterKey: "",
  remoteConsent: false,
  dailyLimit: 20000,
  customBlock: [],
  customAllow: [],
  syncEnabled: false,
  webScan: false,
  blockSites: true,
  blockRemote: true,
  blockDomains: [],
  allowDomains: [],
};

/** Per-site and per-page overrides. `true` = force on, `false` = whitelist (off). Absent = inherit. */
export interface Rules {
  sites: Record<string, boolean>;
  pages: Record<string, { on: boolean; at: number }>;
  /** Cache keys the user marked "bukan judol" (false positives). */
  allow: Record<string, number>;
}

export const DEFAULT_RULES: Rules = { sites: {}, pages: {}, allow: {} };
export const MAX_PAGE_RULES = 500;
export const MAX_ALLOW = 2000;

const pick = <T extends string>(v: unknown, opts: readonly T[], d: T): T =>
  typeof v === "string" && (opts as readonly string[]).includes(v) ? (v as T) : d;
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const str = (v: unknown, d: string) => (typeof v === "string" ? v.slice(0, 2048) : d);
/** Model ids like "jev-latest", "jev-1.13". Anything else falls back to the default. */
const MODEL_RE = /^[A-Za-z0-9._~\/-]{0,64}$/;
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function sanitizeSettings(raw: unknown): Settings {
  const r = obj(raw);
  const s = obj(r.surfaces);
  const d = DEFAULT_SETTINGS;
  return {
    enabled: bool(r.enabled, d.enabled),
    action: pick(r.action, ["blur", "hide", "badge"] as const, d.action),
    sensitivity: pick(r.sensitivity, ["low", "normal", "high"] as const, d.sensitivity),
    blurSuspicious: bool(r.blurSuspicious, d.blurSuspicious),
    preblurLocal: bool(r.preblurLocal, d.preblurLocal),
    surfaces: {
      comment: bool(s.comment, d.surfaces.comment),
      live_chat: bool(s.live_chat, d.surfaces.live_chat),
      video_title: bool(s.video_title, d.surfaces.video_title),
    },
    platforms: Object.fromEntries(
      PLATFORMS.map((p) => [p.id, bool(obj(r.platforms)[p.id], d.platforms[p.id])]),
    ) as Record<PlatformId, boolean>,
    apiKey: str(r.apiKey, d.apiKey).trim(),
    model: MODEL_RE.test(str(r.model, "").trim()) ? str(r.model, "").trim() : d.model,
    openrouterKey: str(r.openrouterKey, d.openrouterKey).trim(),
    remoteConsent: bool(r.remoteConsent, d.remoteConsent),
    dailyLimit:
      typeof r.dailyLimit === "number" && Number.isFinite(r.dailyLimit)
        ? Math.min(1_000_000, Math.max(0, Math.round(r.dailyLimit)))
        : d.dailyLimit,
    customBlock: wordList(r.customBlock),
    customAllow: wordList(r.customAllow),
    syncEnabled: bool(r.syncEnabled, d.syncEnabled),
    webScan: bool(r.webScan, d.webScan),
    blockSites: bool(r.blockSites, d.blockSites),
    blockRemote: bool(r.blockRemote, d.blockRemote),
    blockDomains: domainList(r.blockDomains),
    allowDomains: domainList(r.allowDomains),
  };
}

export function sanitizeRules(raw: unknown): Rules {
  const r = obj(raw);
  const sites: Rules["sites"] = {};
  for (const [k, v] of Object.entries(obj(r.sites))) if (typeof v === "boolean") sites[k] = v;
  const pages: Rules["pages"] = {};
  for (const [k, v] of Object.entries(obj(r.pages))) {
    const p = obj(v);
    if (typeof p.on === "boolean") pages[k] = { on: p.on, at: typeof p.at === "number" ? p.at : 0 };
  }
  const allow: Rules["allow"] = {};
  for (const [k, v] of Object.entries(obj(r.allow))) if (typeof v === "number") allow[k] = v;
  return { sites, pages, allow };
}

function wordList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<string>();
  for (const x of v) {
    if (typeof x !== "string") continue;
    const w = x.replace(/\s+/g, " ").trim().slice(0, 60);
    if (w.length >= 2) out.add(w);
    if (out.size >= 200) break;
  }
  return [...out];
}

function domainList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<string>();
  for (const x of v) {
    const d = typeof x === "string" ? cleanDomain(x) : null;
    if (d) out.add(d);
    if (out.size >= 2000) break;
  }
  return [...out];
}

/** Keep the newest `max` entries of a timestamped record. */
export function pruneNewest<V>(rec: Record<string, V>, max: number, at: (v: V) => number): Record<string, V> {
  const entries = Object.entries(rec);
  if (entries.length <= max) return rec;
  entries.sort((a, b) => at(b[1]) - at(a[1]));
  return Object.fromEntries(entries.slice(0, max));
}

/** Whether a Jev call can be made: a key exists AND the user consented to sending text. */
export function jevConfigured(s: Settings): boolean {
  return s.remoteConsent && (s.apiKey.length > 0 || s.openrouterKey.length > 0);
}

/** Masked view of a secret for UI ("…3f9a"), never the secret itself. */
export function maskKey(k: string): string | null {
  return k ? `…${k.slice(-4)}` : null;
}
