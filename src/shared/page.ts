/**
 * Page / site identity for per-page controls.
 * YouTube URLs carry lots of noise (t=, list=, pp=), so a page is identified by what the
 * user perceives as "this video": watch?v=ID, shorts/ID, live_chat?v=ID → same watch key.
 */
import type { Rules, Settings } from "./settings";

export function siteKeyOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^(?:www|m)\./, "");
  } catch {
    return "";
  }
}

export function pageKeyOf(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "";
  }
  const host = u.hostname.replace(/^(?:www|m)\./, "");
  if (host === "youtube.com") {
    const v = u.searchParams.get("v");
    if (v && /^\/(?:watch|live_chat|live_chat_replay)$/.test(u.pathname)) return `${host}/watch?v=${v}`;
    const shorts = /^\/(shorts|live)\/([\w-]+)/.exec(u.pathname);
    if (shorts) return `${host}/${shorts[1]}/${shorts[2]}`;
    const results = u.searchParams.get("search_query");
    if (u.pathname === "/results" && results) return `${host}/results?search_query=${results}`;
  }
  return host + u.pathname.replace(/\/+$/, "");
}

export type ActiveReason = "global" | "site" | "page";

/** Precedence: page override > site override > global switch. */
export function resolveActive(
  settings: Pick<Settings, "enabled">,
  rules: Pick<Rules, "sites" | "pages">,
  siteKey: string,
  pageKey: string,
): { active: boolean; reason: ActiveReason } {
  const page = rules.pages[pageKey];
  if (page) return { active: page.on, reason: "page" };
  const site = rules.sites[siteKey];
  if (site !== undefined) return { active: site, reason: "site" };
  return { active: settings.enabled, reason: "global" };
}
