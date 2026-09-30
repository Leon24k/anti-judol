/**
 * Gambling-site blocking via declarativeNetRequest (browser-enforced; the extension never sees
 * which pages you visit). Dynamic rules persist across restarts; the remote list refreshes
 * every 12h via chrome.alarms and the last good copy is kept if a download fails.
 */
import { buildRules, mergeDomains, parseList, REMOTE_URL, RULE_BASE, cleanDomain } from "../shared/blocklist";

const K_REMOTE = "aj:blocklist:remote"; // newline-joined domains (last good download)
const K_META = "aj:blocklist:meta";
const ALARM = "aj-blocklist";
const SESSION_BASE = 900_000;

export interface BlockConfig {
  enabled: boolean;
  remote: boolean;
  block: string[];
  allow: string[];
}

export interface BlocklistMeta {
  remoteCount: number;
  activeCount: number;
  updatedAt: number;
  lastError: string | null;
  warningPage: boolean;
}

let meta: BlocklistMeta = { remoteCount: 0, activeCount: 0, updatedAt: 0, lastError: null, warningPage: false };
let remote: string[] | null = null;

export function blocklistMeta(): BlocklistMeta {
  return meta;
}

async function loadRemote(): Promise<string[]> {
  if (remote) return remote;
  const r = await chrome.storage.local.get([K_REMOTE, K_META]);
  if (r[K_META]) meta = { ...meta, ...(r[K_META] as Partial<BlocklistMeta>) };
  remote = typeof r[K_REMOTE] === "string" && r[K_REMOTE] ? (r[K_REMOTE] as string).split("\n") : [];
  return remote;
}

/** Download the community list. Keeps the previous copy on any failure. */
export async function refreshRemote(fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    const res = await fetchImpl(REMOTE_URL, { cache: "no-cache", credentials: "omit", referrerPolicy: "no-referrer" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = parseList(await res.text());
    if (list.length < 1000) throw new Error(`list too small (${list.length})`); // truncated/poisoned download
    remote = list;
    meta = { ...meta, remoteCount: list.length, updatedAt: Date.now(), lastError: null };
    await chrome.storage.local.set({ [K_REMOTE]: list.join("\n"), [K_META]: meta });
  } catch (e) {
    meta = { ...meta, lastError: (e as Error).message };
    await chrome.storage.local.set({ [K_META]: meta });
  }
}

async function hasAllSitesAccess(): Promise<boolean> {
  return chrome.permissions.contains({ origins: ["<all_urls>"] }).catch(() => false);
}

/** Rebuild all blocking rules from config. Safe to call often (single atomic update). */
export async function applyBlocking(cfg: BlockConfig): Promise<void> {
  const existing = (await chrome.declarativeNetRequest.getDynamicRules()).filter((r) => r.id >= RULE_BASE).map((r) => r.id);
  if (!cfg.enabled) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existing });
    meta = { ...meta, activeCount: 0 };
    return;
  }
  const domains = mergeDomains(cfg.remote ? await loadRemote() : [], cfg.block, cfg.allow);
  const warningPage = await hasAllSitesAccess();
  const rules = domains.length ? buildRules(domains, warningPage ? chrome.runtime.getURL("blocked.html") : null) : [];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existing, addRules: rules });
  meta = { ...meta, activeCount: domains.length, warningPage };
  await chrome.storage.local.set({ [K_META]: meta });
}

export async function ensureAlarm(cfg: BlockConfig): Promise<void> {
  if (cfg.enabled && cfg.remote) {
    if (!(await chrome.alarms.get(ALARM))) await chrome.alarms.create(ALARM, { periodInMinutes: 720, delayInMinutes: 1 });
  } else await chrome.alarms.clear(ALARM);
}

export function isBlocklistAlarm(a: chrome.alarms.Alarm): boolean {
  return a.name === ALARM;
}

/** Membership test for the all-sites scanner (suffix match, like DNR requestDomains). */
let lookup: Set<string> | null = null;
let lookupKey = "";
export async function checkHosts(cfg: BlockConfig, hosts: readonly string[]): Promise<string[]> {
  const key = `${cfg.remote}|${cfg.block.join()}|${cfg.allow.join()}|${meta.updatedAt}`;
  if (!lookup || key !== lookupKey) {
    lookup = new Set(mergeDomains(cfg.remote ? await loadRemote() : [], cfg.block, cfg.allow));
    lookupKey = key;
  }
  const out: string[] = [];
  for (const h of hosts.slice(0, 500)) {
    let d = h;
    while (d.includes(".")) {
      if (lookup.has(d)) {
        out.push(h);
        break;
      }
      d = d.slice(d.indexOf(".") + 1);
    }
  }
  return out;
}

/** "Open once": allow this domain in this tab only, until the browser restarts. */
export async function bypassOnce(domainInput: string, tabId: number): Promise<boolean> {
  const domain = cleanDomain(domainInput);
  if (!domain) return false;
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const id = Math.max(SESSION_BASE, ...rules.map((r) => r.id)) + 1;
  await chrome.declarativeNetRequest.updateSessionRules({
    addRules: [
      {
        id,
        priority: 10,
        action: { type: "allow" as chrome.declarativeNetRequest.RuleActionType },
        condition: {
          requestDomains: [domain],
          tabIds: [tabId],
          resourceTypes: ["main_frame", "sub_frame", "image", "media"] as chrome.declarativeNetRequest.ResourceType[],
        },
      },
    ],
  });
  return true;
}
