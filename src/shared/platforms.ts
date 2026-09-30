/**
 * Supported platforms. YouTube is built in (manifest content script + host permission).
 * Every other platform is opt-in: the user enables it in Settings, Chrome asks for that
 * platform's host permission only, and the content script is registered dynamically.
 */
export type PlatformId = "youtube" | "x" | "reddit" | "facebook" | "instagram" | "tiktok" | "twitch" | "disqus";

export interface PlatformInfo {
  id: PlatformId;
  name: string;
  /** Match patterns for host permission + content script registration. */
  matches: string[];
  /** Hostname suffixes this platform owns (for adapter selection in the content script). */
  hosts: string[];
  /** Selectors on these sites change often / are best-effort. */
  beta: boolean;
  builtin: boolean;
  allFrames: boolean;
}

export const PLATFORMS: readonly PlatformInfo[] = [
  { id: "youtube", name: "YouTube", matches: ["https://www.youtube.com/*", "https://m.youtube.com/*"], hosts: ["youtube.com"], beta: false, builtin: true, allFrames: true },
  { id: "x", name: "X (Twitter)", matches: ["https://x.com/*", "https://twitter.com/*", "https://mobile.x.com/*"], hosts: ["x.com", "twitter.com"], beta: false, builtin: false, allFrames: false },
  { id: "reddit", name: "Reddit", matches: ["https://www.reddit.com/*", "https://old.reddit.com/*", "https://sh.reddit.com/*"], hosts: ["reddit.com"], beta: false, builtin: false, allFrames: false },
  { id: "twitch", name: "Twitch", matches: ["https://www.twitch.tv/*"], hosts: ["twitch.tv"], beta: false, builtin: false, allFrames: false },
  { id: "disqus", name: "Disqus (kolom komentar situs berita/blog)", matches: ["https://disqus.com/embed/*"], hosts: ["disqus.com"], beta: false, builtin: false, allFrames: true },
  { id: "facebook", name: "Facebook", matches: ["https://www.facebook.com/*", "https://m.facebook.com/*", "https://web.facebook.com/*"], hosts: ["facebook.com"], beta: true, builtin: false, allFrames: false },
  { id: "instagram", name: "Instagram", matches: ["https://www.instagram.com/*"], hosts: ["instagram.com"], beta: true, builtin: false, allFrames: false },
  { id: "tiktok", name: "TikTok", matches: ["https://www.tiktok.com/*"], hosts: ["tiktok.com"], beta: true, builtin: false, allFrames: false },
];

export const PLATFORM_IDS: readonly PlatformId[] = PLATFORMS.map((p) => p.id);
export const OPTIONAL_PLATFORMS = PLATFORMS.filter((p) => !p.builtin);

export function platformById(id: PlatformId): PlatformInfo {
  return PLATFORMS.find((p) => p.id === id)!;
}

/** Which platform owns this hostname ("www.youtube.com" → youtube). */
export function platformForHost(hostname: string): PlatformInfo | undefined {
  const h = hostname.toLowerCase();
  return PLATFORMS.find((p) => p.hosts.some((s) => h === s || h.endsWith(`.${s}`)));
}
