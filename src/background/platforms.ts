/**
 * Opt-in platforms: content scripts for non-YouTube sites are registered at runtime, only for
 * platforms the user enabled AND whose host permission Chrome granted. Revoking the permission
 * in chrome://extensions automatically unregisters the script on the next sync.
 */
import { OPTIONAL_PLATFORMS, type PlatformId } from "../shared/platforms";

const ID_PREFIX = "aj-platform-";

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
