/**
 * Options page. Writes go through the service worker (single writer).
 * API keys are write-only: the worker never returns them, only a masked hint ("…3f9a").
 */
import { sendBg, type PublicView } from "../shared/messages";
import type { Settings, Surface } from "../shared/settings";

const form = document.getElementById("form") as HTMLFormElement;
const $ = (id: string) => document.getElementById(id) as HTMLElement;

function field(name: string): HTMLInputElement | HTMLSelectElement {
  return form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
}
const checkbox = (n: string) => field(n) as HTMLInputElement;

function fill(v: PublicView): void {
  const s = v.settings;
  for (const k of ["enabled", "blurSuspicious", "preblurLocal", "remoteConsent"] as const) checkbox(k).checked = s[k];
  for (const k of ["action", "sensitivity", "model"] as const) field(k).value = s[k];
  field("dailyLimit").value = String(s.dailyLimit);
  for (const k of Object.keys(s.surfaces) as Surface[]) checkbox(`surfaces.${k}`).checked = s.surfaces[k];
  for (const [name, hint] of [
    ["apiKey", v.keys.typesafe],
    ["openrouterKey", v.keys.openrouter],
  ] as const) {
    field(name).value = "";
    $(`${name}Hint`).textContent = hint ? `(tersimpan ${hint})` : "(belum diisi)";
  }
  $("usage").textContent = `Hari ini: ${v.usage.today.toLocaleString("id-ID")} komentar dikirim`;
}

function read(): Partial<Settings> {
  const patch: Partial<Settings> = {
    enabled: checkbox("enabled").checked,
    blurSuspicious: checkbox("blurSuspicious").checked,
    preblurLocal: checkbox("preblurLocal").checked,
    remoteConsent: checkbox("remoteConsent").checked,
    action: field("action").value as Settings["action"],
    sensitivity: field("sensitivity").value as Settings["sensitivity"],
    model: field("model").value.trim(),
    dailyLimit: Number(field("dailyLimit").value) || 0,
    surfaces: {
      comment: checkbox("surfaces.comment").checked,
      live_chat: checkbox("surfaces.live_chat").checked,
      video_title: checkbox("surfaces.video_title").checked,
    },
  };
  // Empty key field = keep the stored key.
  const apiKey = field("apiKey").value.trim();
  const openrouterKey = field("openrouterKey").value.trim();
  if (apiKey) patch.apiKey = apiKey;
  if (openrouterKey) patch.openrouterKey = openrouterKey;
  return patch;
}

function flash(id: string, text: string): void {
  const el = $(id);
  el.textContent = text;
  setTimeout(() => {
    if (el.textContent === text) el.textContent = "";
  }, 3000);
}

async function save(): Promise<void> {
  fill(await sendBg("settings:update", { patch: read() }));
  flash("saved", "Tersimpan ✓");
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  void save();
});

for (const btn of form.querySelectorAll<HTMLButtonElement>("button[data-clear]")) {
  btn.addEventListener("click", async () => {
    const name = btn.dataset.clear as "apiKey" | "openrouterKey";
    fill(await sendBg("settings:update", { patch: { [name]: "" } }));
    flash("saved", "Key dihapus");
  });
}

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

void sendBg("settings:get", {}).then(fill);
