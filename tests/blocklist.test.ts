import { describe, expect, test } from "bun:test";
import { buildRules, CHUNK, cleanDomain, isProtected, mergeDomains, parseList } from "../src/shared/blocklist";
import { cleanReportUrl, reportText } from "../src/shared/report";
import { sanitizeSettings } from "../src/shared/settings";

describe("blocklist", () => {
  test("cleanDomain normalizes user input", () => {
    expect(cleanDomain("https://www.Slot88.com/daftar?ref=1")).toBe("slot88.com");
    expect(cleanDomain("*.gacor.xyz")).toBe("gacor.xyz");
    expect(cleanDomain("  judi-777.net.  ")).toBe("judi-777.net");
    expect(cleanDomain("kasino.рф")).toBe("kasino.xn--p1ai");
    for (const bad of ["", "# comment", "localhost", "not a domain", "a..b.com", "-x.com", "http://", "1.2"]) expect(cleanDomain(bad)).toBeNull();
  });

  test("parseList skips comments and junk", () => {
    const list = parseList("# Title: x\nslot88.com\n\nGACOR.XYZ\nbad domain\n  togel.net  \n");
    expect(list).toEqual(["slot88.com", "gacor.xyz", "togel.net"]);
  });

  test("protected domains can never be blocked", () => {
    for (const d of ["google.com", "www.youtube.com", "kemenkeu.go.id", "ui.ac.id", "klikbca.com", "sub.detik.com"]) expect(isProtected(d)).toBe(true);
    expect(isProtected("slot88.com")).toBe(false);
    expect(isProtected("googlecom.slot.xyz")).toBe(false);
  });

  test("merge: remote + user block − user allow − protected, deduped", () => {
    const out = mergeDomains(["slot88.com", "google.com", "togel.net", "safe.example.com"], ["https://my-judi.id/", "slot88.com"], ["example.com"]);
    expect(out.sort()).toEqual(["my-judi.id", "slot88.com", "togel.net"]);
  });

  test("rules: chunked; plain block without host access, redirect + subresource block with it", () => {
    const domains = Array.from({ length: CHUNK * 2 + 10 }, (_, i) => `d${i}.com`);
    const plain = buildRules(domains, null);
    expect(plain).toHaveLength(3);
    expect(plain.every((r) => r.action.type === "block")).toBe(true);
    expect(plain[0]!.condition.resourceTypes).toContain("main_frame");
    const all = plain.flatMap((r) => r.condition.requestDomains ?? []);
    expect(new Set(all).size).toBe(domains.length);

    const warn = buildRules(domains, "chrome-extension://abc/blocked.html");
    expect(warn).toHaveLength(6);
    const redirect = warn.filter((r) => r.action.type === "redirect");
    expect(redirect).toHaveLength(3);
    expect(redirect[0]!.condition.resourceTypes).toEqual(["main_frame"]);
    expect(redirect[0]!.action.redirect?.regexSubstitution).toBe("chrome-extension://abc/blocked.html#\\0");
    expect(warn.filter((r) => r.action.type === "block").every((r) => !r.condition.resourceTypes?.includes("main_frame"))).toBe(true);
    expect(new Set(warn.map((r) => r.id)).size).toBe(warn.length);
  });

  test("settings sanitize domain lists", () => {
    const s = sanitizeSettings({ blockDomains: ["Slot88.com", "junk!!", 5, "slot88.com"], allowDomains: "nope" });
    expect(s.blockDomains).toEqual(["slot88.com"]);
    expect(s.allowDomains).toEqual([]);
    expect(s.blockSites).toBe(true);
  });
});

describe("report", () => {
  test("strips tracking params and fragments", () => {
    expect(cleanReportUrl("https://slot88.com/daftar?utm_source=yt&ref=abc&fbclid=x#top")).toBe("https://slot88.com/daftar?ref=abc");
    expect(cleanReportUrl("javascript:alert(1)")).toBe("");
  });

  test("report text is ready to paste", () => {
    const t = reportText(
      { url: "https://www.youtube.com/watch?v=abc&pp=xyz", evidence: "s l o t   gacor\n maxwin", where: "komentar YouTube" },
      new Date(2026, 8, 30, 20, 0),
    );
    expect(t).toContain("Kategori: Perjudian");
    expect(t).toContain("Tautan: https://www.youtube.com/watch?v=abc");
    expect(t).not.toContain("pp=");
    expect(t).toContain('Isi konten: "s l o t gacor maxwin"');
    expect(t).toContain("Ditemukan di: komentar YouTube");
  });
});
