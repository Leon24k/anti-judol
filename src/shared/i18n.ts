/**
 * UI text via chrome.i18n (static/_locales/{en,id}/messages.json). The language follows the
 * browser's UI language; English is the fallback. Keys are type-checked against the English file.
 *
 * HTML: <el data-i18n="key"> sets textContent; data-i18n-attr="placeholder:key;aria-label:key"
 * sets attributes. No innerHTML anywhere.
 */
export type MsgKey = keyof typeof import("../../static/_locales/en/messages.json");

export function t(key: MsgKey, ...subs: Array<string | number>): string {
  const api = (globalThis as { chrome?: typeof chrome }).chrome?.i18n;
  const msg = api?.getMessage(key, subs.map(String));
  // Unit tests (no chrome.i18n) and missing keys fall back to the key itself.
  return msg || key;
}

/** BCP-47 tag of the active UI language, for number/date formatting. */
export function lang(): string {
  const l = t("langCode");
  return l === "langCode" ? "en" : l;
}

export function applyI18n(root: ParentNode & Node = document): void {
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const text = t(el.dataset.i18n as MsgKey);
    if (el.tagName === "TITLE") document.title = text;
    else el.textContent = text;
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n-attr]")) {
    for (const pair of el.dataset.i18nAttr!.split(";")) {
      const [attr, key] = pair.split(":").map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key as MsgKey));
    }
  }
  if (root === document) document.documentElement.lang = lang();
}
