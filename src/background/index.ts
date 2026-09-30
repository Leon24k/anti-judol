/**
 * Service worker: the single writer for settings/rules, owner of the API key, and the
 * shared Jev batching scheduler for all tabs.
 */
import type { BgMessages, BgRequest, BgType, ContentConfig, JevStatus } from "../shared/messages";
import { PRIVILEGED } from "../shared/messages";
import { t } from "../shared/i18n";
import { resolveActive } from "../shared/page";
import {
  DEFAULT_RULES,
  DEFAULT_SETTINGS,
  MAX_ALLOW,
  MAX_PAGE_RULES,
  jevConfigured,
  maskKey,
  pruneNewest,
  sanitizeRules,
  sanitizeSettings,
  type Rules,
  type Settings,
} from "../shared/settings";
import { classifyWithFallback, endpointsFor } from "./jev";
import { applyBlocking, blocklistMeta, bypassOnce, checkHosts, ensureAlarm, isBlocklistAlarm, refreshRemote } from "./blocking";
import { grantedPlatforms, hasAllSites, syncPlatformScripts, syncWebScript } from "./platforms";
import { DailyQuota } from "./quota";
import { Scheduler } from "./scheduler";
import { clearSync, onRemoteChange, pull, schedulePush } from "./sync";
import { fromPortable, mergeAllow, toPortable, type Portable } from "../shared/portable";

const K_SETTINGS = "aj:settings";
const K_RULES = "aj:rules";
const K_CACHE = "aj:cache";
const K_USAGE = "aj:usage";

// Settings (incl. API keys) readable only by the service worker and extension pages,
// never by content scripts, even if one were compromised.
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});

let settings: Settings = DEFAULT_SETTINGS;
let webScanActive = false;
let rules: Rules = DEFAULT_RULES;
let status: JevStatus = { state: "disabled" };
const quota = new DailyQuota(() => settings.dailyLimit);

const scheduler = new Scheduler({
  send: (items) => {
    quota.consume(items.length);
    persistUsageSoon();
    return classifyWithFallback(items, endpointsFor(settings));
  },
  available: () => jevConfigured(settings) && quota.available,
  sensitivity: () => settings.sensitivity,
  onStatus: (s) => {
    status = s;
    persistCacheSoon();
  },
});

// ---------- state load / persist ----------

const ready = (async () => {
  const [local, session] = await Promise.all([
    chrome.storage.local.get([K_SETTINGS, K_RULES, K_USAGE]),
    chrome.storage.session.get(K_CACHE).catch(() => ({}) as Record<string, unknown>),
  ]);
  settings = sanitizeSettings(local[K_SETTINGS]);
  rules = sanitizeRules(local[K_RULES]);
  quota.load(local[K_USAGE]);
  const cached = session[K_CACHE];
  if (Array.isArray(cached)) scheduler.cache.load(cached);
  status = jevConfigured(settings) ? status : { state: "disabled" };
  await syncPlatformScripts(settings.platforms).catch(() => {});
  webScanActive = await syncWebScript(settings.webScan).catch(() => false);
  void setupBlocking(false);
})();

onRemoteChange((p) => void ready.then(() => applyRemote(p)).catch(() => {}));

const blockCfg = () => ({ enabled: settings.blockSites, remote: settings.blockRemote, block: settings.blockDomains, allow: settings.allowDomains });

/** Serialized so overlapping updates can't interleave rule writes. */
let blockChain: Promise<void> = Promise.resolve();
function setupBlocking(refresh: boolean): Promise<void> {
  blockChain = blockChain
    .then(async () => {
      const cfg = blockCfg();
      await ensureAlarm(cfg);
      if (cfg.enabled && cfg.remote && (refresh || blocklistMeta().updatedAt === 0)) await refreshRemote();
      await applyBlocking(cfg);
    })
    .catch((e) => console.warn("blocking setup failed", e));
  return blockChain;
}

chrome.alarms.onAlarm.addListener((a) => {
  if (isBlocklistAlarm(a)) void ready.then(() => setupBlocking(true));
});

// User granted/revoked a site in chrome://extensions → keep registrations consistent.
const onPermChange = () =>
  void ready
    .then(async () => {
      await syncPlatformScripts(settings.platforms);
      webScanActive = await syncWebScript(settings.webScan);
      await setupBlocking(false); // warning page vs plain block depends on <all_urls>
    })
    .catch(() => {});
chrome.permissions.onAdded.addListener(onPermChange);
chrome.permissions.onRemoved.addListener(onPermChange);

let cacheTimer: ReturnType<typeof setTimeout> | undefined;
function persistCacheSoon(): void {
  if (cacheTimer !== undefined) return;
  cacheTimer = setTimeout(() => {
    cacheTimer = undefined;
    // Session storage survives service-worker restarts but not browser restarts.
    void chrome.storage.session.set({ [K_CACHE]: scheduler.cache.dump() }).catch(() => {});
  }, 2000);
}

let usageTimer: ReturnType<typeof setTimeout> | undefined;
function persistUsageSoon(): void {
  if (usageTimer !== undefined) return;
  usageTimer = setTimeout(() => {
    usageTimer = undefined;
    void chrome.storage.local.set({ [K_USAGE]: quota.snapshot() }).catch(() => {});
  }, 5000);
}

/** What extension pages get back: settings without secrets + masked key hints. */
function publicView() {
  const { apiKey, openrouterKey, ...rest } = settings;
  return {
    settings: rest,
    keys: { typesafe: maskKey(apiKey), openrouter: maskKey(openrouterKey) },
    usage: { today: quota.used, limit: settings.dailyLimit },
  };
}

/** Single path for every settings change (UI, import, sync from another device). */
async function commitSettings(next: Settings, fromRemote = false): Promise<void> {
  const prev = settings;
  settings = next;
  await chrome.storage.local.set({ [K_SETTINGS]: settings });
  await syncPlatformScripts(settings.platforms).catch(() => {});
  webScanActive = await syncWebScript(settings.webScan).catch(() => false);
  if (
    prev.blockSites !== settings.blockSites ||
    prev.blockRemote !== settings.blockRemote ||
    prev.blockDomains.join() !== settings.blockDomains.join() ||
    prev.allowDomains.join() !== settings.allowDomains.join()
  )
    await setupBlocking(false);
  if (
    prev.apiKey !== settings.apiKey ||
    prev.openrouterKey !== settings.openrouterKey ||
    prev.model !== settings.model ||
    prev.remoteConsent !== settings.remoteConsent
  ) {
    scheduler.reset();
    scheduler.cache.clear();
    status = { state: "disabled" };
  }
  if (prev.syncEnabled && !settings.syncEnabled) await clearSync().catch(() => {});
  // Never re-push a change that came from sync (would ping-pong between devices).
  if (settings.syncEnabled && !fromRemote) {
    if (!prev.syncEnabled) await adoptRemote(); // first enable: pull what other devices already have
    schedulePush(() => ({ settings, rules }));
  }
  // Sensitivity change needs no cache purge: probabilities are cached, thresholds apply at read time.
  await broadcast();
}

/** Merge a blob from another device: its settings win, whitelists are unioned, keys stay local. */
async function applyRemote(p: Portable): Promise<void> {
  if (!settings.syncEnabled) return; // this device opted out
  const r = fromPortable(p, settings);
  if (!r || !r.settings.syncEnabled) return;
  rules = { ...rules, sites: { ...rules.sites, ...r.rules.sites }, allow: mergeAllow(rules.allow, r.rules.allow) };
  await chrome.storage.local.set({ [K_RULES]: rules });
  await commitSettings({ ...r.settings, syncEnabled: true }, true);
}

async function adoptRemote(): Promise<void> {
  const p = await pull().catch(() => null);
  if (!p) return;
  const r = fromPortable(p, settings);
  if (r) rules = { ...rules, sites: { ...r.rules.sites, ...rules.sites }, allow: mergeAllow(rules.allow, r.rules.allow) };
  await chrome.storage.local.set({ [K_RULES]: rules });
}

async function saveRules(): Promise<void> {
  rules = {
    sites: rules.sites,
    pages: pruneNewest(rules.pages, MAX_PAGE_RULES, (v) => v.at),
    allow: pruneNewest(rules.allow, MAX_ALLOW, (v) => v),
  };
  await chrome.storage.local.set({ [K_RULES]: rules });
  if (settings.syncEnabled) schedulePush(() => ({ settings, rules }));
  await broadcast();
}

async function broadcast(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map((t) =>
      t.id === undefined ? undefined : chrome.tabs.sendMessage(t.id, { type: "config:changed" }).catch(() => {}),
    ),
  );
}

function contentConfig(pageKey: string, siteKey: string): ContentConfig {
  const { active, reason } = resolveActive(settings, rules, siteKey, pageKey);
  return {
    active,
    reason,
    action: settings.action,
    sensitivity: settings.sensitivity,
    blurSuspicious: settings.blurSuspicious,
    preblurLocal: settings.preblurLocal,
    surfaces: settings.surfaces,
    platforms: settings.platforms,
    webScan: webScanActive,
    customBlock: settings.customBlock,
    customAllow: settings.customAllow,
    jevAvailable: jevConfigured(settings) && status.state !== "unauthorized",
    allowKeys: Object.keys(rules.allow),
  };
}

// ---------- handlers ----------

type Handlers = { [T in BgType]: (req: BgRequest<T>) => Promise<BgMessages[T]["res"]> };

const handlers: Handlers = {
  async classify({ items }) {
    const safe = items.slice(0, 200).filter((i) => typeof i.key === "string" && typeof i.text === "string");
    const allowed = safe.filter((i) => rules.allow[i.key] !== undefined);
    const rest = safe.filter((i) => rules.allow[i.key] === undefined);
    const results = await scheduler.classify(
      rest.map((i) => ({ ...i, text: i.text.slice(0, 500), author: i.author?.slice(0, 100) })),
    );
    for (const i of allowed) results.push({ key: i.key, verdict: "SAFE", source: "user", pJudol: 0 });
    return { results };
  },
  async "state:get"({ pageKey, siteKey }) {
    return contentConfig(pageKey, siteKey);
  },
  async "rule:allow"({ key }) {
    rules.allow[key] = Date.now();
    await saveRules();
    return { ok: true };
  },
  async "rules:site"({ siteKey, on }) {
    if (on === null) delete rules.sites[siteKey];
    else rules.sites[siteKey] = on;
    await saveRules();
    return { ok: true };
  },
  async "rules:page"({ pageKey, on }) {
    if (on === null) delete rules.pages[pageKey];
    else rules.pages[pageKey] = { on, at: Date.now() };
    await saveRules();
    return { ok: true };
  },
  async "rules:clearAllow"() {
    rules.allow = {};
    await saveRules();
    return { ok: true };
  },
  async "rules:get"({ pageKey, siteKey }) {
    return {
      site: rules.sites[siteKey] ?? null,
      page: rules.pages[pageKey]?.on ?? null,
      allowCount: Object.keys(rules.allow).length,
      global: settings.enabled,
    };
  },
  async "settings:get"() {
    return { ...publicView(), status, grantedPlatforms: [...(await grantedPlatforms())], allSites: await hasAllSites() };
  },
  async "settings:update"({ patch }) {
    await commitSettings(
      sanitizeSettings({
        ...settings,
        ...patch,
        surfaces: { ...settings.surfaces, ...patch.surfaces },
        platforms: { ...settings.platforms, ...patch.platforms },
      }),
    );
    return publicView();
  },
  async "data:export"() {
    return toPortable(settings, rules);
  },
  async "data:import"({ data }) {
    const r = fromPortable(data, settings);
    if (!r) return { ok: false as const, reason: "invalid" };
    rules = { ...rules, sites: { ...rules.sites, ...r.rules.sites }, allow: mergeAllow(rules.allow, r.rules.allow) };
    await saveRules();
    await commitSettings(r.settings);
    return { ok: true as const, reason: "" };
  },
  async "block:check"({ hosts }) {
    if (!Array.isArray(hosts)) return { blocked: [] };
    const clean = hosts.filter((h): h is string => typeof h === "string" && h.length < 254);
    return { blocked: await checkHosts(blockCfg(), clean) };
  },
  async "block:status"() {
    return blocklistMeta();
  },
  async "block:refresh"() {
    await setupBlocking(true);
    return blocklistMeta();
  },
  async "block:bypass"({ domain, tabId }) {
    return { ok: await bypassOnce(domain, tabId) };
  },
  async "block:allowDomain"({ domain }) {
    await commitSettings(sanitizeSettings({ ...settings, allowDomains: [...settings.allowDomains, domain] }));
    return { ok: true };
  },
  async "cache:clear"() {
    scheduler.cache.clear();
    await chrome.storage.session.remove(K_CACHE).catch(() => {});
    return { ok: true };
  },
  async "jev:test"() {
    if (!settings.remoteConsent) return { ok: false, latencyMs: 0, detail: t("testNeedConsent") };
    if (!jevConfigured(settings)) return { ok: false, latencyMs: 0, detail: t("testNoKey") };
    const t0 = performance.now();
    try {
      const [p] = await classifyWithFallback(
        [{ key: "test", surface: "comment", text: "d4ftar sekarang di GACOR88 dijamin maxwin, depo 10rb" }],
        endpointsFor(settings),
      );
      const latencyMs = Math.round(performance.now() - t0);
      status = { state: "ok", latencyMs };
      scheduler.reset();
      return { ok: !!p, latencyMs, detail: p ? `P(JUDOL_PROMO)=${p.JUDOL_PROMO.toFixed(2)}` : t("testBadResponse") };
    } catch (e) {
      const latencyMs = Math.round(performance.now() - t0);
      return { ok: false, latencyMs, detail: (e as Error).message };
    }
  },
};

// ---------- router ----------

const EXT_ORIGIN = chrome.runtime.getURL("");

chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg !== "object") return false;
  const type = (msg as { type?: unknown }).type as BgType;
  const handler = handlers[type] as ((r: unknown) => Promise<unknown>) | undefined;
  if (!handler) return false;
  // Settings/key/rules management only from our own extension pages, never from content scripts.
  if (PRIVILEGED.has(type) && !sender.url?.startsWith(EXT_ORIGIN)) {
    sendResponse({ error: "forbidden" });
    return false;
  }
  ready
    .then(() => handler(msg))
    .then(sendResponse, (e: unknown) => sendResponse({ error: String((e as Error)?.message ?? e) }));
  return true; // async response
});

chrome.runtime.onInstalled.addListener((d) => {
  if (d.reason === "install") void chrome.runtime.openOptionsPage();
});
