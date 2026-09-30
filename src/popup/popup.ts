/** Popup: per-page / per-site toggles, temporary reveal, stats. */
import { sendBg, sendTab, type JevStatus, type PageInfo } from "../shared/messages";
import { ADUAN_URL, reportText } from "../shared/report";
import { applyI18n, t } from "../shared/i18n";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const chk = (id: string) => $<HTMLInputElement>(id);

function renderStatus(s: JevStatus, hasKey: boolean): void {
  const el = $("jev");
  el.className = "pill";
  if (s.state === "ok") {
    el.textContent = t("statusJevOk", s.latencyMs);
    el.classList.add("ok");
  } else if (s.state === "unauthorized") {
    el.textContent = t("statusKeyRejected");
    el.classList.add("err");
  } else if (s.state === "error") {
    el.textContent = t("statusJevError");
    el.title = s.message;
    el.classList.add("err");
  } else {
    el.textContent = hasKey ? t("statusJevReady") : t("statusLocal");
    if (!hasKey) el.classList.add("local");
  }
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function main(): Promise<void> {
  applyI18n();
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
    $("allowCount").textContent = r.allowCount ? t("popupAllowCount", r.allowCount) : "";
    return;
  }
  const tabId = tab.id;
  const { pageKey, siteKey } = info;
  $("page").hidden = false;
  $("pageKey").textContent = pageKey;
  $("siteLabel").textContent = t("popupSiteOn", siteKey);

  async function renderPage(): Promise<void> {
    const r = await sendBg("rules:get", { pageKey, siteKey });
    const siteActive = r.site ?? r.global;
    const pageActive = r.page ?? siteActive;
    chk("pageOn").checked = pageActive;
    chk("siteOn").checked = siteActive;
    $("reason").textContent =
      r.page !== null ? t("reasonPage") : r.site !== null ? t("reasonSite") : t("reasonGlobal");
    $("resetPage").hidden = r.page === null;
    $("allowCount").textContent = r.allowCount ? t("popupAllowCount", r.allowCount) : "";
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
  $("reportPage").addEventListener("click", async () => {
    const i = await sendTab(tabId, "page:info", {}, 0).catch(() => info!);
    const where = i.stats.judol ? `halaman dengan ${i.stats.judol} konten judi terdeteksi` : "halaman web";
    const text = reportText({ url: i.url, where });
    try {
      await navigator.clipboard.writeText(text);
      $("reportHint").textContent = t("reportCopied");
    } catch {
      $("reportHint").textContent = t("reportCopyFailed");
    }
    await chrome.tabs.create({ url: ADUAN_URL });
  });

  chk("revealAll").addEventListener("change", () => {
    // Broadcast to all frames (live chat iframe too); not persisted — resets on navigation.
    void chrome.tabs.sendMessage(tabId, { type: "page:reveal", revealed: chk("revealAll").checked }).catch(() => {});
  });

  await Promise.all([renderPage(), renderStats()]);
  setInterval(() => void renderStats(), 1000);
}

void main();
