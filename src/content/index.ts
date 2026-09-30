/** Content-script entry: wires the Scanner to the service worker, SPA navigation, and popup messages. */
import { sendBg, type ContentConfig, type PageInfo, type TabRequest } from "../shared/messages";
import { pageKeyOf, siteKeyOf } from "../shared/page";
import { Scanner } from "./scanner";

const isTop = window.top === window;

/** Live chat runs in a same-origin iframe; it belongs to the parent video's page. */
function pageUrl(): string {
  if (!isTop) {
    try {
      return window.parent.location.href;
    } catch {
      /* cross-origin parent: fall through */
    }
  }
  return location.href;
}

let pageKey = pageKeyOf(pageUrl());
let siteKey = siteKeyOf(pageUrl());

const scanner = new Scanner(document, {
  classify: async (items) => (await sendBg("classify", { items })).results,
  onAllow: (key) => void sendBg("rule:allow", { key }).catch(() => {}),
});

let refreshSeq = 0;
async function refresh(): Promise<void> {
  const seq = ++refreshSeq;
  let cfg: ContentConfig;
  try {
    cfg = await sendBg("state:get", { pageKey, siteKey });
  } catch {
    return; // extension context gone (reload/update); leave the page untouched
  }
  if (seq === refreshSeq) scanner.start(cfg);
}

function onNavigate(): void {
  const next = pageKeyOf(pageUrl());
  if (next === pageKey) return;
  pageKey = next;
  siteKey = siteKeyOf(pageUrl());
  scanner.resetPageStats();
  void refresh();
}

document.addEventListener("yt-navigate-finish", onNavigate);
window.addEventListener("popstate", onNavigate);
// Fallback for navigations YouTube does without its custom event (and for m.youtube.com).
setInterval(onNavigate, 1000);

chrome.runtime.onMessage.addListener((msg: TabRequest, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  switch (msg.type) {
    case "config:changed":
      void refresh();
      return false;
    case "page:info": {
      if (!isTop) return false; // only the top frame answers
      const info: PageInfo = { pageKey, siteKey, stats: scanner.stats, revealed: scanner.revealed };
      sendResponse(info);
      return false;
    }
    case "page:reveal":
      scanner.setRevealAll(Boolean((msg as TabRequest<"page:reveal">).revealed));
      if (isTop) sendResponse({ ok: true });
      return false;
  }
  return false;
});

void refresh();

if (__DEV__) (globalThis as { __aj?: Scanner }).__aj = scanner;
