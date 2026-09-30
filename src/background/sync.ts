/**
 * Opt-in Chrome Sync. Pushes settings + site rules + whitelist (never API keys) to
 * chrome.storage.sync, and merges changes coming from the user's other devices.
 * Writes are debounced (sync has per-minute write quotas).
 */
import { decodeSync, encodeSync, SYNC_PREFIX, toPortable, type Portable } from "../shared/portable";
import type { Rules, Settings } from "../shared/settings";

let timer: ReturnType<typeof setTimeout> | undefined;
let lastPushedAt = 0;

export function schedulePush(get: () => { settings: Settings; rules: Rules }, delayMs = 4000): void {
  clearTimeout(timer);
  timer = setTimeout(() => void push(get()), delayMs);
}

export async function push({ settings, rules }: { settings: Settings; rules: Rules }): Promise<void> {
  if (!settings.syncEnabled) return;
  const blob = toPortable(settings, rules);
  lastPushedAt = blob.exportedAt;
  const items = encodeSync(blob);
  const old = Object.keys(await chrome.storage.sync.get(null)).filter((k) => k.startsWith(SYNC_PREFIX) && !(k in items));
  await chrome.storage.sync.set(items);
  if (old.length) await chrome.storage.sync.remove(old);
}

export async function pull(): Promise<Portable | null> {
  return decodeSync(await chrome.storage.sync.get(null));
}

/** Remove everything we put in sync (user turned sync off). */
export async function clearSync(): Promise<void> {
  const keys = Object.keys(await chrome.storage.sync.get(null)).filter((k) => k.startsWith(SYNC_PREFIX));
  if (keys.length) await chrome.storage.sync.remove(keys);
}

/** Listen for changes pushed by other devices (ignores our own echo). */
export function onRemoteChange(apply: (p: Portable) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !Object.keys(changes).some((k) => k.startsWith(SYNC_PREFIX))) return;
    void pull().then((p) => {
      if (p && p.exportedAt !== lastPushedAt) apply(p);
    });
  });
}
