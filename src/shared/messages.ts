/** Typed message contracts between content script, popup/options, and the service worker. */
import type { ActiveReason } from "./page";
import type { PlatformId } from "./platforms";
import type { Action, Sensitivity, Settings, Surface } from "./settings";
import type { Verdict, VerdictSource } from "./verdict";

export interface ClassifyItem {
  key: string;
  surface: Surface;
  platform?: PlatformId | undefined;
  text: string;
  author?: string | undefined;
  localScore: number;
  /** Higher = sooner. Live chat gets a boost since it scrolls away quickly. */
  priority: number;
}

export interface ClassifyResult {
  key: string;
  verdict: Verdict;
  source: VerdictSource;
  /** P(JUDOL_PROMO) from Jev, or the local score for local verdicts. */
  pJudol: number;
}

export type JevStatus =
  | { state: "disabled" }
  | { state: "ok"; latencyMs: number }
  | { state: "error"; message: string; at: number }
  | { state: "unauthorized"; at: number };

/** Non-secret config the content script needs (never includes the API key). */
export interface ContentConfig {
  active: boolean;
  reason: ActiveReason;
  action: Action;
  sensitivity: Sensitivity;
  blurSuspicious: boolean;
  preblurLocal: boolean;
  surfaces: Record<Surface, boolean>;
  /** Which platforms the user enabled (content script checks its own). */
  platforms: Record<PlatformId, boolean>;
  /** All-sites ad/link scanner enabled (and <all_urls> granted). */
  webScan: boolean;
  jevAvailable: boolean;
  allowKeys: string[];
}

export interface PageStats {
  scanned: number;
  judol: number;
  suspicious: number;
}

export interface PageInfo {
  pageKey: string;
  siteKey: string;
  stats: PageStats;
  revealed: boolean;
}

export interface BlocklistStatus {
  remoteCount: number;
  activeCount: number;
  updatedAt: number;
  /** Last download failure (not named `error`: that key marks a failed response). */
  lastError: string | null;
  warningPage: boolean;
}

/** Settings as seen by extension pages: secrets are never returned, only masked hints. */
export type PublicSettings = Omit<Settings, "apiKey" | "openrouterKey">;
export interface PublicView {
  settings: PublicSettings;
  keys: { typesafe: string | null; openrouter: string | null };
  usage: { today: number; limit: number };
}

/** Messages handled by the service worker: request → response. */
export interface BgMessages {
  classify: { req: { items: ClassifyItem[] }; res: { results: ClassifyResult[] } };
  "state:get": { req: { pageKey: string; siteKey: string }; res: ContentConfig };
  "rule:allow": { req: { key: string }; res: { ok: true } };
  "rules:site": { req: { siteKey: string; on: boolean | null }; res: { ok: true } };
  "rules:page": { req: { pageKey: string; on: boolean | null }; res: { ok: true } };
  "rules:clearAllow": { req: Record<string, never>; res: { ok: true } };
  "rules:get": { req: { pageKey: string; siteKey: string }; res: { site: boolean | null; page: boolean | null; allowCount: number; global: boolean } };
  "settings:get": { req: Record<string, never>; res: PublicView & { status: JevStatus; grantedPlatforms: PlatformId[]; allSites: boolean } };
  "settings:update": { req: { patch: Partial<Settings> }; res: PublicView };
  "cache:clear": { req: Record<string, never>; res: { ok: true } };
  "block:status": { req: Record<string, never>; res: BlocklistStatus };
  "block:refresh": { req: Record<string, never>; res: BlocklistStatus };
  "block:bypass": { req: { domain: string; tabId: number }; res: { ok: boolean } };
  "block:allowDomain": { req: { domain: string }; res: { ok: true } };
  /** Content scripts ask which hosts on the page are known gambling domains (no network). */
  "block:check": { req: { hosts: string[] }; res: { blocked: string[] } };
  "jev:test": { req: Record<string, never>; res: { ok: boolean; latencyMs: number; detail: string } };
}
export type BgType = keyof BgMessages;
export type BgRequest<T extends BgType = BgType> = { type: T } & BgMessages[T]["req"];

/** Only extension pages (popup/options) may send these. */
export const PRIVILEGED: ReadonlySet<BgType> = new Set<BgType>([
  "settings:get",
  "settings:update",
  "rules:site",
  "rules:page",
  "rules:clearAllow",
  "cache:clear",
  "jev:test",
  "block:status",
  "block:refresh",
  "block:bypass",
  "block:allowDomain",
]);

/** Messages handled by content scripts (sent via chrome.tabs.sendMessage). */
export interface TabMessages {
  "config:changed": { req: Record<string, never>; res: void };
  "page:info": { req: Record<string, never>; res: PageInfo };
  "page:reveal": { req: { revealed: boolean }; res: { ok: true } };
}
export type TabType = keyof TabMessages;
export type TabRequest<T extends TabType = TabType> = { type: T } & TabMessages[T]["req"];

export async function sendBg<T extends BgType>(type: T, req: BgMessages[T]["req"]): Promise<BgMessages[T]["res"]> {
  const res: unknown = await chrome.runtime.sendMessage({ type, ...req });
  if (res && typeof res === "object" && "error" in res) throw new Error(String((res as { error: unknown }).error));
  return res as BgMessages[T]["res"];
}

export async function sendTab<T extends TabType>(
  tabId: number,
  type: T,
  req: TabMessages[T]["req"],
  frameId?: number,
): Promise<TabMessages[T]["res"]> {
  const opts = frameId === undefined ? {} : { frameId };
  return (await chrome.tabs.sendMessage(tabId, { type, ...req }, opts)) as TabMessages[T]["res"];
}
