/**
 * YouTube DOM adapters. Each adapter names a *container* (the element we mark/blur) and where
 * its text + author live. YouTube renames components often, so old and new names are listed;
 * adding a surface/site is just another entry here.
 */
import type { Surface } from "../shared/settings";

export interface Adapter {
  surface: Surface;
  container: string;
  text: string;
  author?: string;
}

export const ADAPTERS: readonly Adapter[] = [
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
];

export const ALL_CONTAINERS = ADAPTERS.map((a) => a.container).join(", ");

export function adapterFor(el: Element): Adapter | undefined {
  for (const a of ADAPTERS) if (el.matches(a.container)) return a;
  return undefined;
}

export function extract(el: Element, a: Adapter): { text: string; author: string } {
  const text = el.querySelector(a.text)?.textContent?.trim() ?? "";
  const author = a.author ? (el.querySelector(a.author)?.textContent?.trim() ?? "") : "";
  return { text, author };
}
