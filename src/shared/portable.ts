/**
 * Portable user data: export/import file and opt-in Chrome Sync.
 * API keys are NEVER included (not in the file, not in sync).
 */
import { MAX_ALLOW, sanitizeRules, sanitizeSettings, type Rules, type Settings } from "./settings";

export const SECRET_KEYS = ["apiKey", "openrouterKey"] as const;
export type PortableSettings = Omit<Settings, (typeof SECRET_KEYS)[number]>;

export interface Portable {
  app: "anti-judol";
  version: 1;
  exportedAt: number;
  settings: PortableSettings;
  rules: Pick<Rules, "sites" | "allow">;
}

export function stripSecrets(s: Settings): PortableSettings {
  const { apiKey: _a, openrouterKey: _o, ...rest } = s;
  return rest;
}

export function toPortable(s: Settings, r: Rules, now = Date.now()): Portable {
  return { app: "anti-judol", version: 1, exportedAt: now, settings: stripSecrets(s), rules: { sites: r.sites, allow: r.allow } };
}

/** Validate an imported/synced blob. Secrets in the input are ignored; local keys are kept. */
export function fromPortable(raw: unknown, local: Settings): { settings: Settings; rules: Pick<Rules, "sites" | "allow"> } | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<Portable>;
  if (p.app !== "anti-judol" || p.version !== 1) return null;
  const incoming = { ...(p.settings as object) } as Record<string, unknown>;
  for (const k of SECRET_KEYS) delete incoming[k];
  const settings = sanitizeSettings({ ...local, ...incoming, apiKey: local.apiKey, openrouterKey: local.openrouterKey });
  const r = sanitizeRules({ sites: p.rules?.sites, allow: p.rules?.allow, pages: {} });
  return { settings, rules: { sites: r.sites, allow: r.allow } };
}

/** Union of whitelists (newest timestamp wins), capped. */
export function mergeAllow(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [k, t] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, t);
  const entries = Object.entries(out);
  if (entries.length <= MAX_ALLOW) return out;
  return Object.fromEntries(entries.sort((x, y) => y[1] - x[1]).slice(0, MAX_ALLOW));
}

// ---------- chrome.storage.sync chunking (8 KB per item, ~100 KB total) ----------

export const SYNC_PREFIX = "aj:s:";
export const SYNC_CHUNK = 7000;
export const SYNC_MAX_BYTES = 90_000;

/** Encode into sync items; the whitelist is trimmed (oldest first) until it fits. */
export function encodeSync(p: Portable): Record<string, string | number> {
  let blob = p;
  let json = JSON.stringify(blob);
  while (json.length > SYNC_MAX_BYTES) {
    const allow = Object.entries(blob.rules.allow).sort((x, y) => y[1] - x[1]);
    blob = { ...blob, rules: { ...blob.rules, allow: Object.fromEntries(allow.slice(0, Math.floor(allow.length * 0.8))) } };
    json = JSON.stringify(blob);
  }
  const items: Record<string, string | number> = {};
  const n = Math.ceil(json.length / SYNC_CHUNK);
  for (let i = 0; i < n; i++) items[`${SYNC_PREFIX}${i}`] = json.slice(i * SYNC_CHUNK, (i + 1) * SYNC_CHUNK);
  items[`${SYNC_PREFIX}n`] = n;
  return items;
}

export function decodeSync(items: Record<string, unknown>): Portable | null {
  const n = items[`${SYNC_PREFIX}n`];
  if (typeof n !== "number" || n < 1 || n > 20) return null;
  let json = "";
  for (let i = 0; i < n; i++) {
    const part = items[`${SYNC_PREFIX}${i}`];
    if (typeof part !== "string") return null;
    json += part;
  }
  try {
    return JSON.parse(json) as Portable;
  } catch {
    return null;
  }
}
