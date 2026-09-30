/**
 * DOM adapters per platform. Each adapter names a *container* (the element we mark/blur) and
 * where its text + author live. Sites rename things often, so several selectors are listed;
 * adding a site = adding entries here (+ a PlatformInfo in shared/platforms.ts).
 *
 * `author` may be a selector or `@attr` to read an attribute of the container itself.
 */
import { platformForHost, type PlatformId } from "../shared/platforms";
import type { Surface } from "../shared/settings";

export interface Adapter {
  surface: Surface;
  container: string;
  text: string;
  author?: string;
  /** Skip containers nested inside another container of the same adapter (e.g. quoted tweets). */
  outermost?: boolean;
}

export const ADAPTERS: Record<PlatformId, readonly Adapter[]> = {
  youtube: [
    {
      surface: "comment",
      container: "ytd-comment-view-model, ytd-comment-renderer, ytm-comment-renderer",
      text: "#content-text, .comment-text",
      author: "#author-text, .comment-header .user-text",
    },
    {
      surface: "live_chat",
      container: "yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer",
      text: "#message",
      author: "#author-name",
    },
    {
      surface: "video_title",
      container:
        "ytd-rich-grid-media, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, " +
        "ytd-playlist-video-renderer, ytd-reel-item-renderer, yt-lockup-view-model, ytm-shorts-lockup-view-model, " +
        "ytm-video-with-context-renderer, ytd-watch-metadata",
      text: "#video-title, .yt-lockup-metadata-view-model__title, h3, h1",
      author: "ytd-channel-name #text, .yt-content-metadata-view-model__metadata-text",
    },
  ],
  x: [
    {
      surface: "comment",
      container: 'article[data-testid="tweet"]',
      text: '[data-testid="tweetText"]',
      author: '[data-testid="User-Name"]',
      outermost: true,
    },
    // Newer markup (seen 2026-09 on logged-out pages): no data-testid, engagement bar marks a post.
    {
      surface: "comment",
      container: "article:not([data-testid]):has([data-engagement-action])",
      text: 'div.whitespace-pre-wrap[dir="auto"]',
      author: 'a[href^="/"]:not([href*="/status/"]) span, a[href^="/"]:not([href*="/status/"])',
      outermost: true,
    },
  ],
  reddit: [
    { surface: "comment", container: "shreddit-comment", text: '[slot="comment"]', author: "@author" },
    { surface: "video_title", container: "shreddit-post", text: '[slot="title"], a[slot="full-post-link"]', author: "@author" },
    // old.reddit.com
    { surface: "comment", container: ".thing.comment", text: ".usertext-body", author: ".author" },
    { surface: "video_title", container: ".thing.link", text: "a.title", author: ".author" },
  ],
  twitch: [
    {
      surface: "live_chat",
      container: ".chat-line__message, .vod-message",
      text: '[data-a-target="chat-line-message-body"], [data-a-target="chat-message-text"], .text-fragment',
      author: ".chat-author__display-name",
    },
  ],
  disqus: [{ surface: "comment", container: "li.post", text: ".post-message", author: ".author, .post-byline .author" }],
  facebook: [
    {
      surface: "comment",
      container: 'div[role="article"]',
      text: 'div[dir="auto"]',
      author: 'a[role="link"] span[dir="auto"], h3 a, strong a',
      outermost: false,
    },
  ],
  instagram: [
    {
      surface: "comment",
      container: "ul ul > div[role='button'], ul > li._a9zj, div._a9zr",
      text: "span[dir='auto']:not(:has(a)), span._ap3a",
      author: "h3 a, a[role='link'] span, span._aap6",
    },
  ],
  tiktok: [
    {
      surface: "comment",
      container: '[data-e2e="comment-level-1"], [data-e2e="comment-level-2"], [class*="DivCommentItemWrapper"], [class*="DivCommentContentContainer"]',
      text: '[data-e2e="comment-level-1"] p, [data-e2e="comment-level-2"] p, p[data-e2e^="comment-level"], span[data-e2e="comment-level-1"], span[data-e2e="comment-level-2"]',
      author: '[data-e2e^="comment-username"]',
    },
  ],
};

export interface AdapterSet {
  platform: PlatformId;
  adapters: readonly Adapter[];
  /** Combined selector for fast `closest` / `querySelectorAll`. */
  containers: string;
}

export function adaptersForHost(hostname: string): AdapterSet | null {
  const p = platformForHost(hostname);
  if (!p) return null;
  const adapters = ADAPTERS[p.id];
  return { platform: p.id, adapters, containers: adapters.map((a) => a.container).join(", ") };
}

export function adapterFor(el: Element, set: AdapterSet): Adapter | undefined {
  for (const a of set.adapters) {
    if (!el.matches(a.container)) continue;
    if (a.outermost && el.parentElement?.closest(a.container)) return undefined;
    return a;
  }
  return undefined;
}

export function extract(el: Element, a: Adapter): { text: string; author: string } {
  // Collect all matching text nodes (Facebook/Instagram split a comment over several).
  let text = "";
  const nodes = el.querySelectorAll(a.text);
  if (nodes.length === 1) text = nodes[0]!.textContent ?? "";
  else if (nodes.length > 1) {
    const seen = new Set<string>();
    for (const n of nodes) {
      const t = n.textContent?.trim();
      if (t && !seen.has(t)) {
        seen.add(t);
        text += (text ? " " : "") + t;
      }
      if (text.length > 1000) break;
    }
  }
  let author = "";
  if (a.author?.startsWith("@")) author = el.getAttribute(a.author.slice(1)) ?? "";
  else if (a.author) {
    // First match with visible text (the first link is often an avatar image).
    for (const n of el.querySelectorAll(a.author)) {
      const t = n.textContent?.trim();
      if (t) {
        author = t;
        break;
      }
    }
  }
  return { text: text.trim(), author: author.trim() };
}
