import { describe, expect, test } from "bun:test";
import { Glob } from "bun";

type Messages = Record<string, { message: string }>;
const en: Messages = await Bun.file("static/_locales/en/messages.json").json();
const id: Messages = await Bun.file("static/_locales/id/messages.json").json();
const placeholders = (m: string) => [...m.replace(/\$\$/g, "").matchAll(/\$(\d)/g)].map((x) => x[1]).sort().join(",");

async function usedKeys(): Promise<Set<string>> {
  const used = new Set<string>();
  for await (const f of new Glob("static/*.{html,json}").scan()) {
    const s = await Bun.file(f).text();
    for (const m of s.matchAll(/data-i18n="([^"]+)"/g)) used.add(m[1]!);
    for (const m of s.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const p of m[1]!.split(";")) used.add(p.split(":")[1]!.trim());
    for (const m of s.matchAll(/__MSG_(\w+)__/g)) used.add(m[1]!);
  }
  for await (const f of new Glob("src/**/*.ts").scan()) {
    const s = await Bun.file(f).text();
    // t("key"), t(cond ? "a" : "b"), and key maps (LABEL) all appear as string literals.
    for (const m of s.matchAll(/"([a-z][A-Za-z0-9]+)"/g)) if (m[1]! in en) used.add(m[1]!);
  }
  used.add("langCode");
  return used;
}

describe("i18n", () => {
  test("en and id define the same keys", () => {
    expect(Object.keys(id).sort()).toEqual(Object.keys(en).sort());
  });

  test("placeholders match between languages; no stray $", () => {
    for (const k of Object.keys(en)) {
      expect({ k, p: placeholders(id[k]!.message) }).toEqual({ k, p: placeholders(en[k]!.message) });
      for (const m of [en[k]!.message, id[k]!.message]) expect(m.replace(/\$\$/g, "")).not.toMatch(/\$(?!\d)/);
    }
  });

  test("every used key exists, and every defined key is used", async () => {
    const used = await usedKeys();
    const defined = new Set(Object.keys(en));
    expect([...used].filter((k) => !defined.has(k))).toEqual([]);
    expect([...defined].filter((k) => !used.has(k))).toEqual([]);
  });

  test("store limits: name ≤ 75, description ≤ 132 characters", () => {
    for (const m of [en, id]) {
      expect(m.extName!.message.length).toBeLessThanOrEqual(75);
      expect(m.extDescription!.message.length).toBeLessThanOrEqual(132);
    }
  });

  test("no leftover hard-coded Indonesian UI text in extension pages", async () => {
    for (const f of ["static/popup.html", "static/options.html", "static/blocked.html"]) {
      const body = (await Bun.file(f).text()).replace(/<style>[\s\S]*?<\/style>/, "").replace(/<[^>]+>/g, " ");
      expect({ f, words: body.match(/\b(yang|dan|untuk|tidak|situs|halaman|komentar)\b/gi) ?? [] }).toEqual({ f, words: [] });
    }
  });
});
