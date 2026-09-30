/**
 * Pure helpers for the gambling-domain blocklist (no chrome.* here, so it is unit-testable).
 *
 * Sources, merged:  remote community list (HaGeZi Gambling mini, fetched daily, GPL-3.0, not
 * bundled) + the user's own "block" domains.  Minus:  the user's "allow" domains and a built-in
 * PROTECT list so a poisoned/buggy list can never take down search, banks, gov/edu sites, etc.
 */

export const REMOTE_URL = "https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/gambling.mini-onlydomains.txt";
export const MAX_DOMAINS = 250_000;
export const CHUNK = 5_000;

/** Never block these (or their subdomains). Hacked gov/edu sites host judol *pages*, not domains. */
export const PROTECT_SUFFIXES = [
  "go.id", "ac.id", "sch.id", "mil.id", "desa.id", "or.id", "net.id",
  "google.com", "google.co.id", "youtube.com", "youtu.be", "gstatic.com", "googleapis.com", "googleusercontent.com",
  "facebook.com", "fbcdn.net", "instagram.com", "whatsapp.com", "x.com", "twitter.com", "twimg.com", "tiktok.com",
  "reddit.com", "twitch.tv", "disqus.com", "wikipedia.org", "github.com", "microsoft.com", "apple.com", "cloudflare.com",
  "jsdelivr.net", "typesafe.ai", "openrouter.ai", "tokopedia.com", "shopee.co.id", "bukalapak.com", "gojek.com", "grab.com",
  "bca.co.id", "klikbca.com", "bankmandiri.co.id", "bri.co.id", "bni.co.id", "btn.co.id", "cimbniaga.co.id", "danamon.co.id",
  "dana.id", "ovo.id", "linkaja.id", "detik.com", "kompas.com", "tribunnews.com", "liputan6.com", "cnnindonesia.com",
];

const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;

/** Normalize user input like "https://www.Slot88.com/path" → "slot88.com". Returns null if invalid. */
export function cleanDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s || s.startsWith("#")) return null;
  s = s.replace(/^\*\./, "").replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/[/?#:].*$/, "").replace(/^www\./, "").replace(/\.$/, "");
  try {
    if (/[^\x00-\x7f]/.test(s)) s = new URL(`http://${s}`).hostname; // IDN → punycode
  } catch {
    return null;
  }
  return DOMAIN_RE.test(s) ? s : null;
}

export function isProtected(domain: string, extraAllow: ReadonlySet<string> = new Set()): boolean {
  for (const suf of PROTECT_SUFFIXES) if (domain === suf || domain.endsWith(`.${suf}`)) return true;
  // User allow list also covers subdomains.
  let d = domain;
  while (true) {
    if (extraAllow.has(d)) return true;
    const i = d.indexOf(".");
    if (i < 0) return false;
    d = d.slice(i + 1);
  }
}

/** Parse a plain-domains list (one per line, # comments). */
export function parseList(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const d = cleanDomain(line);
    if (d) out.push(d);
    if (out.length >= MAX_DOMAINS) break;
  }
  return out;
}

export function mergeDomains(remote: readonly string[], userBlock: readonly string[], userAllow: readonly string[]): string[] {
  const allow = new Set(userAllow.map(cleanDomain).filter((d): d is string => !!d));
  const set = new Set<string>();
  for (const d of [...userBlock.map(cleanDomain), ...remote]) if (d && !isProtected(d, allow)) set.add(d);
  return [...set].slice(0, MAX_DOMAINS);
}

// ---------- DNR rule construction ----------

export const RULE_BASE = 1000; // ids 1000+ are ours; <1000 reserved
const BLOCK_TYPES: chrome.declarativeNetRequest.ResourceType[] = [
  "main_frame" as chrome.declarativeNetRequest.ResourceType,
  "sub_frame" as chrome.declarativeNetRequest.ResourceType,
  "image" as chrome.declarativeNetRequest.ResourceType,
  "media" as chrome.declarativeNetRequest.ResourceType,
];
const SUB_TYPES = BLOCK_TYPES.filter((t) => t !== "main_frame");

/**
 * `redirectTo`: extension URL of the warning page. Only usable when the extension has host
 * access to the blocked sites (optional <all_urls>); otherwise main frames are plainly blocked.
 */
export function buildRules(domains: readonly string[], redirectTo: string | null): chrome.declarativeNetRequest.Rule[] {
  const rules: chrome.declarativeNetRequest.Rule[] = [];
  let id = RULE_BASE;
  for (let i = 0; i < domains.length; i += CHUNK) {
    const requestDomains = domains.slice(i, i + CHUNK);
    if (redirectTo) {
      rules.push({
        id: id++,
        priority: 2,
        action: {
          type: "redirect" as chrome.declarativeNetRequest.RuleActionType,
          redirect: { regexSubstitution: `${redirectTo}#\\0` },
        },
        condition: { regexFilter: "^https?://.*", requestDomains, resourceTypes: ["main_frame" as chrome.declarativeNetRequest.ResourceType] },
      });
      rules.push({
        id: id++,
        priority: 1,
        action: { type: "block" as chrome.declarativeNetRequest.RuleActionType },
        condition: { requestDomains, resourceTypes: SUB_TYPES },
      });
    } else {
      rules.push({
        id: id++,
        priority: 1,
        action: { type: "block" as chrome.declarativeNetRequest.RuleActionType },
        condition: { requestDomains, resourceTypes: BLOCK_TYPES },
      });
    }
  }
  return rules;
}
