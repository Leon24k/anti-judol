/** Popup: per-page / per-site toggles, temporary reveal, stats. */
import { sendBg, sendTab, type JevStatus, type PageInfo } from "../shared/messages";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const chk = (id: string) => $<HTMLInputElement>(id);

function renderStatus(s: JevStatus, hasKey: boolean): void {
  const el = $("jev");
  el.className = "pill";
  if (s.state === "ok") {
    el.textContent = `Jev ✓ ${s.latencyMs}ms`;
    el.classList.add("ok");
  } else if (s.state === "unauthorized") {
    el.textContent = "API key ditolak";
    el.classList.add("err");
  } else if (s.state === "error") {
    el.textContent = "Jev error → lokal";
    el.title = s.message;
    el.classList.add("err");
  } else {
    el.textContent = hasKey ? "Jev siap" : "Mode lokal";
    if (!hasKey) el.classList.add("local");
  }
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function main(): Promise<void> {
  $("openOptions").addEventListener("click", () => void chrome.runtime.openOptionsPage());
  const { settings, status, keys } = await sendBg("settings:get", {});
  renderStatus(status, settings.remoteConsent && (keys.typesafe !== null || keys.openrouter !== null));

  const tab = await activeTab();
  let info: PageInfo | undefined;
  if (tab?.id !== undefined) {
    try {
      info = await sendTab(tab.id, "page:info", {}, 0);
    } catch {
      info = undefined; // no content script on this tab
    }
  }

  const globalOn = chk("globalOn");
  globalOn.checked = settings.enabled;
  globalOn.addEventListener("change", async () => {
    await sendBg("settings:update", { patch: { enabled: globalOn.checked } });
    await renderPage();
  });

  if (!info || tab?.id === undefined) {
    $("unsupported").hidden = false;
    const r = await sendBg("rules:get", { pageKey: "", siteKey: "" });
    $("allowCount").textContent = r.allowCount ? `${r.allowCount} komentar di-whitelist` : "";
    return;
  }
  const tabId = tab.id;
  const { pageKey, siteKey } = info;
  $("page").hidden = false;
  $("pageKey").textContent = pageKey;
  $("siteName").textContent = siteKey;

  async function renderPage(): Promise<void> {
    const r = await sendBg("rules:get", { pageKey, siteKey });
    const siteActive = r.site ?? r.global;
    const pageActive = r.page ?? siteActive;
    chk("pageOn").checked = pageActive;
    chk("siteOn").checked = siteActive;
    $("reason").textContent =
      r.page !== null ? "Aturan khusus halaman ini" : r.site !== null ? "Mengikuti aturan situs" : "Mengikuti pengaturan global";
    $("resetPage").hidden = r.page === null;
    $("allowCount").textContent = r.allowCount ? `${r.allowCount} komentar di-whitelist` : "";
  }

  async function renderStats(): Promise<void> {
    try {
      const i = await sendTab(tabId, "page:info", {}, 0);
      $("sScanned").textContent = String(i.stats.scanned);
      $("sJudol").textContent = String(i.stats.judol);
      $("sSusp").textContent = String(i.stats.suspicious);
      chk("revealAll").checked = i.revealed;
    } catch {
      /* tab navigated away */
    }
  }

  chk("pageOn").addEventListener("change", async () => {
    await sendBg("rules:page", { pageKey, on: chk("pageOn").checked });
    await renderPage();
  });
  chk("siteOn").addEventListener("change", async () => {
    await sendBg("rules:site", { siteKey, on: chk("siteOn").checked });
    await renderPage();
  });
  $("resetPage").addEventListener("click", async () => {
    await sendBg("rules:page", { pageKey, on: null });
    await renderPage();
  });
  chk("revealAll").addEventListener("change", () => {
    // Broadcast to all frames (live chat iframe too); not persisted — resets on navigation.
    void chrome.tabs.sendMessage(tabId, { type: "page:reveal", revealed: chk("revealAll").checked }).catch(() => {});
  });

  await Promise.all([renderPage(), renderStats()]);
  setInterval(() => void renderStats(), 1000);
}

void main();
