/**
 * Opt-in platforms: content scripts for non-YouTube sites are registered at runtime, only for
 * platforms the user enabled AND whose host permission Chrome granted. Revoking the permission
 * in chrome://extensions automatically unregisters the script on the next sync.
 */
import { OPTIONAL_PLATFORMS, PLATFORMS, type PlatformId } from "../shared/platforms";

const ID_PREFIX = "aj-platform-";
const WEB_ID = "aj-web";

export async function hasAllSites(): Promise<boolean> {
  return chrome.permissions.contains({ origins: ["<all_urls>"] }).catch(() => false);
}

/**
 * All-sites scanner: one registration for every http(s) page except the platforms, which have
 * their own scanner. Top frame + ad iframes (all_frames) so banners inside iframes are caught.
 */
export async function syncWebScript(enabled: boolean): Promise<boolean> {
  const on = enabled && (await hasAllSites());
  const existing = (await chrome.scripting.getRegisteredContentScripts({ ids: [WEB_ID] })).length > 0;
  if (on && !existing)
    await chrome.scripting.registerContentScripts([
      {
        id: WEB_ID,
        matches: ["https://*/*", "http://*/*"],
        excludeMatches: PLATFORMS.flatMap((p) => p.matches),
        js: ["content.js"],
        css: ["content.css"],
        runAt: "document_idle",
        allFrames: true,
        persistAcrossSessions: true,
      },
    ]);
  else if (!on && existing) await chrome.scripting.unregisterContentScripts({ ids: [WEB_ID] });
  return on;
}

export async function grantedPlatforms(): Promise<Set<PlatformId>> {
  const out = new Set<PlatformId>();
  await Promise.all(
    OPTIONAL_PLATFORMS.map(async (p) => {
      if (await chrome.permissions.contains({ origins: p.matches })) out.add(p.id);
    }),
  );
  return out;
}

/** Make registered content scripts exactly match (enabled ∩ granted). */
export async function syncPlatformScripts(enabled: Record<PlatformId, boolean>): Promise<Set<PlatformId>> {
  const granted = await grantedPlatforms();
  const want = OPTIONAL_PLATFORMS.filter((p) => enabled[p.id] && granted.has(p.id));
  const existing = await chrome.scripting.getRegisteredContentScripts();
  const have = new Set(existing.map((s) => s.id).filter((id) => id.startsWith(ID_PREFIX)));
  const wantIds = new Set(want.map((p) => ID_PREFIX + p.id));

  const remove = [...have].filter((id) => !wantIds.has(id));
  if (remove.length) await chrome.scripting.unregisterContentScripts({ ids: remove });

  const add = want.filter((p) => !have.has(ID_PREFIX + p.id));
  if (add.length)
    await chrome.scripting.registerContentScripts(
      add.map((p) => ({
        id: ID_PREFIX + p.id,
        matches: p.matches,
        js: ["content.js"],
        css: ["content.css"],
        runAt: "document_start" as const,
        allFrames: p.allFrames,
        persistAcrossSessions: true,
      })),
    );
  return new Set(want.map((p) => p.id));
}
