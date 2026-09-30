/**
 * Options page. Writes go through the service worker (single writer).
 * API keys are write-only: the worker never returns them, only a masked hint ("…3f9a").
 */
import { sendBg, type PublicView } from "../shared/messages";
import { PLATFORMS, platformById, type PlatformId } from "../shared/platforms";
import type { Settings, Surface } from "../shared/settings";

const form = document.getElementById("form") as HTMLFormElement;
const $ = (id: string) => document.getElementById(id) as HTMLElement;

function field(name: string): HTMLInputElement | HTMLSelectElement {
  return form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
}
const checkbox = (n: string) => field(n) as HTMLInputElement;

let granted = new Set<PlatformId>();
let allSites = false;
const ALL = { origins: ["<all_urls>"] };

$("webScan").addEventListener("change", (e) => {
  const cb = e.target as HTMLInputElement;
  const on = cb.checked;
  // permissions.request must be called synchronously in the click handler.
  const ask = on ? chrome.permissions.request(ALL) : Promise.resolve(true);
  void ask.then(async (ok) => {
    if (!ok) {
      cb.checked = false;
      flash("saved", "Izin semua situs ditolak");
      return;
    }
    if (!on) await chrome.permissions.remove(ALL).catch(() => false);
    fill(await sendBg("settings:update", { patch: { webScan: on } }));
    allSites = (await sendBg("settings:get", {})).allSites;
    ($("webScan") as HTMLInputElement).checked = on && allSites;
    flash("saved", on ? "Pemindaian semua situs aktif ✓" : "Pemindaian semua situs dimatikan");
  });
});

function renderPlatforms(v: PublicView): void {
  const box = $("platforms");
  box.replaceChildren();
  for (const p of PLATFORMS) {
    const label = document.createElement("label");
    label.className = "row";
    const name = document.createElement("span");
    name.textContent = p.name;
    if (p.beta) {
      const b = document.createElement("span");
      b.className = "pill";
      b.textContent = "beta";
      name.append(" ", b);
    }
    if (!p.builtin && v.settings.platforms[p.id] && !granted.has(p.id)) {
      const w = document.createElement("span");
      w.className = "muted small";
      w.textContent = " (izin belum diberikan)";
      name.append(w);
    }
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.dataset.platform = p.id;
    cb.checked = v.settings.platforms[p.id] && (p.builtin || granted.has(p.id));
    label.append(name, cb);
    box.append(label);
  }
}

// Must run synchronously inside the click → permissions.request needs the user gesture.
$("platforms").addEventListener("change", (e) => {
  const cb = e.target as HTMLInputElement;
  const id = cb.dataset.platform as PlatformId | undefined;
  if (!id) return;
  const p = platformById(id);
  const on = cb.checked;
  const ask = on && !p.builtin ? chrome.permissions.request({ origins: p.matches }) : Promise.resolve(true);
  void ask.then(async (ok) => {
    if (!ok) {
      cb.checked = false;
      flash("saved", `Izin ${p.name} ditolak`);
      return;
    }
    if (!on && !p.builtin) await chrome.permissions.remove({ origins: p.matches }).catch(() => false);
    const r = await sendBg("settings:update", { patch: { platforms: { [id]: on } as Record<PlatformId, boolean> } });
    const g = await sendBg("settings:get", {});
    granted = new Set(g.grantedPlatforms);
    fill(r);
    flash("saved", on ? `${p.name} aktif ✓ (muat ulang tab ${p.name} yang terbuka)` : `${p.name} dimatikan`);
  });
});

function fill(v: PublicView): void {
  const s = v.settings;
  renderPlatforms(v);
  ($("webScan") as HTMLInputElement).checked = s.webScan && allSites;
  for (const k of ["enabled", "blurSuspicious", "preblurLocal", "remoteConsent", "blockSites", "blockRemote", "syncEnabled"] as const) checkbox(k).checked = s[k];
  (field("customBlock") as unknown as HTMLTextAreaElement).value = s.customBlock.join("\n");
  (field("customAllow") as unknown as HTMLTextAreaElement).value = s.customAllow.join("\n");
  (field("blockDomains") as unknown as HTMLTextAreaElement).value = s.blockDomains.join("\n");
  (field("allowDomains") as unknown as HTMLTextAreaElement).value = s.allowDomains.join("\n");
  void renderBlockStatus();
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

const phrases = (n: string) =>
  (field(n) as unknown as HTMLTextAreaElement).value.split("\n").map((x) => x.trim()).filter(Boolean);
const lines = (n: string) =>
  (field(n) as unknown as HTMLTextAreaElement).value.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

async function renderBlockStatus(): Promise<void> {
  const b = await sendBg("block:status", {});
  const when = b.updatedAt ? new Date(b.updatedAt).toLocaleString("id-ID") : "belum pernah";
  $("blockStatus").textContent =
    `Aktif: ${b.activeCount.toLocaleString("id-ID")} domain · daftar komunitas diperbarui ${when}` +
    (b.lastError ? ` · gagal terakhir: ${b.lastError}` : "");
}

$("blockRefresh").addEventListener("click", async () => {
  $("blockStatus").textContent = "Mengunduh…";
  await sendBg("block:refresh", {});
  await renderBlockStatus();
});

function read(): Partial<Settings> {
  const patch: Partial<Settings> = {
    enabled: checkbox("enabled").checked,
    blurSuspicious: checkbox("blurSuspicious").checked,
    preblurLocal: checkbox("preblurLocal").checked,
    remoteConsent: checkbox("remoteConsent").checked,
    blockSites: checkbox("blockSites").checked,
    syncEnabled: checkbox("syncEnabled").checked,
    customBlock: phrases("customBlock"),
    customAllow: phrases("customAllow"),
    blockRemote: checkbox("blockRemote").checked,
    blockDomains: lines("blockDomains"),
    allowDomains: lines("allowDomains"),
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

$("export").addEventListener("click", async () => {
  const data = await sendBg("data:export", {});
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `anti-judol-pengaturan-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  flash("dataResult", "Diekspor (tanpa API key)");
});
$("importBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (file.size > 1_000_000) return flash("dataResult", "File terlalu besar");
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return flash("dataResult", "File bukan JSON yang valid");
  }
  const r = await sendBg("data:import", { data });
  if (!r.ok) return flash("dataResult", r.reason);
  fill(await sendBg("settings:get", {}));
  flash("dataResult", "Pengaturan diimpor ✓ (API key tetap milik perangkat ini)");
});

$("clearAllow").addEventListener("click", async () => {
  await sendBg("rules:clearAllow", {});
  flash("dataResult", "Whitelist dihapus");
});
$("clearCache").addEventListener("click", async () => {
  await sendBg("cache:clear", {});
  flash("dataResult", "Cache dihapus");
});

void sendBg("settings:get", {}).then((v) => {
  granted = new Set(v.grantedPlatforms);
  allSites = v.allSites;
  fill(v);
});
