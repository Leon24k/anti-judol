/** Options page: global settings + API keys. Writes go through the service worker (single writer). */
import { sendBg } from "../shared/messages";
import type { Settings, Surface } from "../shared/settings";

const form = document.getElementById("form") as HTMLFormElement;
const $ = (id: string) => document.getElementById(id) as HTMLElement;

function field(name: string): HTMLInputElement | HTMLSelectElement {
  return form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
}

function fill(s: Settings): void {
  for (const k of ["enabled", "blurSuspicious", "preblurLocal"] as const) (field(k) as HTMLInputElement).checked = s[k];
  for (const k of ["action", "sensitivity", "apiKey", "endpoint", "model", "openrouterKey"] as const) field(k).value = s[k];
  for (const k of Object.keys(s.surfaces) as Surface[]) (field(`surfaces.${k}`) as HTMLInputElement).checked = s.surfaces[k];
}

function read(): Partial<Settings> {
  const checked = (n: string) => (field(n) as HTMLInputElement).checked;
  return {
    enabled: checked("enabled"),
    blurSuspicious: checked("blurSuspicious"),
    preblurLocal: checked("preblurLocal"),
    action: field("action").value as Settings["action"],
    sensitivity: field("sensitivity").value as Settings["sensitivity"],
    apiKey: field("apiKey").value.trim(),
    endpoint: field("endpoint").value.trim(),
    model: field("model").value.trim(),
    openrouterKey: field("openrouterKey").value.trim(),
    surfaces: { comment: checked("surfaces.comment"), live_chat: checked("surfaces.live_chat"), video_title: checked("surfaces.video_title") },
  };
}

function flash(id: string, text: string): void {
  const el = $(id);
  el.textContent = text;
  setTimeout(() => {
    if (el.textContent === text) el.textContent = "";
  }, 3000);
}

async function save(): Promise<void> {
  const patch = read();
  if (patch.endpoint && !/^https:\/\//.test(patch.endpoint)) {
    flash("saved", "Base URL harus diawali https://");
    return;
  }
  const { settings } = await sendBg("settings:update", { patch });
  fill(settings);
  flash("saved", "Tersimpan ✓");
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  void save();
});

$("test").addEventListener("click", async () => {
  await save();
  $("testResult").textContent = "Menguji…";
  const r = await sendBg("jev:test", {});
  $("testResult").textContent = r.ok ? `✓ ${r.latencyMs}ms · ${r.detail}` : `✗ ${r.detail}`;
});

$("clearAllow").addEventListener("click", async () => {
  await sendBg("rules:clearAllow", {});
  flash("dataResult", "Whitelist dihapus");
});
$("clearCache").addEventListener("click", async () => {
  await sendBg("cache:clear", {});
  flash("dataResult", "Cache dihapus");
});

void sendBg("settings:get", {}).then(({ settings }) => fill(settings));
