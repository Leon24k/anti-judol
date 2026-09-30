/** Warning page shown instead of a blocked gambling site (only when <all_urls> access is granted). */
import { cleanDomain } from "../shared/blocklist";
import { sendBg } from "../shared/messages";
import { applyI18n, t } from "../shared/i18n";
import { ADUAN_URL, reportText } from "../shared/report";

const $ = (id: string) => document.getElementById(id) as HTMLElement;

// DNR redirect appends the original URL after '#'.
const original = decodeURIComponent(location.hash.slice(1));
let domain = "";
try {
  const u = new URL(original);
  if (u.protocol === "http:" || u.protocol === "https:") domain = cleanDomain(u.hostname) ?? "";
} catch {
  /* malformed */
}
applyI18n();
$("domain").textContent = domain || t("blockedUnknown");
if (domain) document.title = t("blockedTitleDomain", domain);

$("back").addEventListener("click", () => {
  // Two steps back skips the redirect entry; fall back to a fresh tab.
  if (history.length > 2) history.go(-2);
  else
    void tabId().then((id) => {
      if (id !== undefined) void chrome.tabs.update(id, { url: "chrome://newtab/" });
    });
});

$("report").addEventListener("click", async () => {
  const text = reportText({ url: original, where: "tautan situs judi (diblokir oleh Anti-Judol Shield)" });
  try {
    await navigator.clipboard.writeText(text);
    $("reportHint").textContent = t("blockedReportCopied");
  } catch {
    $("reportHint").textContent = t("blockedReportFallback", original);
  }
  window.open(ADUAN_URL, "_blank", "noopener");
});

async function tabId(): Promise<number | undefined> {
  return (await chrome.tabs.getCurrent())?.id;
}

$("once").addEventListener("click", async () => {
  const id = await tabId();
  if (!domain || id === undefined) return;
  if (!confirm(t("blockedConfirmOnce", domain))) return;
  await sendBg("block:bypass", { domain, tabId: id });
  location.replace(original);
});

$("allow").addEventListener("click", async () => {
  if (!domain) return;
  if (!confirm(t("blockedConfirmAllow", domain))) return;
  await sendBg("block:allowDomain", { domain });
  $("result").textContent = t("blockedSavedOpening");
  setTimeout(() => location.replace(original), 400);
});

if (!domain) for (const id of ["once", "allow", "report"]) ($(id) as HTMLButtonElement).disabled = true;
