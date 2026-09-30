import { afterEach, describe, expect, test } from "bun:test";
import { ADAPTERS, adapterFor, adaptersForHost, extract } from "../src/content/adapters";
import { Scanner } from "../src/content/scanner";
import type { ContentConfig } from "../src/shared/messages";
import { OPTIONAL_PLATFORMS, PLATFORMS, platformForHost, type PlatformId } from "../src/shared/platforms";

/** Minimal markup mirroring each site's real DOM structure (selectors as of 2026-09). */
const FIXTURES: Record<Exclude<PlatformId, "youtube">, { host: string; html: string }> = {
  x: {
    host: "x.com",
    html: `<article data-testid="tweet"><div data-testid="User-Name"><span>SLOT88 Official</span><span>@slot88</span></div>
      <div data-testid="tweetText"><span>daftar sekarang s l o t g4c0r maxwin, cek bio</span></div>
      <article data-testid="tweet"><div data-testid="tweetText">quoted inner tweet</div></article></article>`,
  },
  reddit: {
    host: "www.reddit.com",
    html: `<shreddit-comment author="gacor_bot"><div slot="comment"><p>situs slot gacor maxwin depo 10rb</p></div></shreddit-comment>`,
  },
  twitch: {
    host: "www.twitch.tv",
    html: `<div class="chat-line__message"><span class="chat-author__display-name">JUDI888</span>
      <span data-a-target="chat-line-message-body"><span class="text-fragment">wd cepat gacor maxwin klik bio</span></span></div>`,
  },
  disqus: {
    host: "disqus.com",
    html: `<ul id="post-list"><li class="post"><div class="post-byline"><span class="author">kasino310</span></div>
      <div class="post-message"><p>kasino310 (dot) com depo 10rb langsung jp</p></div></li></ul>`,
  },
  facebook: {
    host: "www.facebook.com",
    html: `<div role="article"><h3><a href="#">Pulau777 Resmi</a></h3><div dir="auto">main di PULAU777 auto jp paus, link di profil</div>
      <div dir="auto">slot gacor maxwin</div></div>`,
  },
  instagram: {
    host: "www.instagram.com",
    html: `<ul><ul><div role="button"><h3><a href="#">judol.gacor88</a></h3><span dir="auto">ｓｌｏｔ ｇａｃｏｒ maxwin depo 10rb</span></div></ul></ul>`,
  },
  tiktok: {
    host: "www.tiktok.com",
    html: `<div data-e2e="comment-level-1"><a data-e2e="comment-username-1">gacor.official</a><p>s l o t g4c0r hari ini maxwin cek bio</p></div>`,
  },
};

const allPlatforms = (on: boolean) => Object.fromEntries(PLATFORMS.map((p) => [p.id, on])) as Record<PlatformId, boolean>;
const cfg = (over: Partial<ContentConfig> = {}): ContentConfig => ({
  active: true,
  reason: "global",
  action: "blur",
  sensitivity: "normal",
  blurSuspicious: true,
  preblurLocal: true,
  surfaces: { comment: true, live_chat: true, video_title: true },
  platforms: allPlatforms(true),
  jevAvailable: false,
  allowKeys: [],
  ...over,
});
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

describe("platform registry", () => {
  test("every platform has adapters", () => {
    for (const p of PLATFORMS) expect(ADAPTERS[p.id].length).toBeGreaterThan(0);
  });

  test("host → platform", () => {
    expect(platformForHost("www.youtube.com")?.id).toBe("youtube");
    expect(platformForHost("m.youtube.com")?.id).toBe("youtube");
    expect(platformForHost("old.reddit.com")?.id).toBe("reddit");
    expect(platformForHost("twitter.com")?.id).toBe("x");
    expect(platformForHost("disqus.com")?.id).toBe("disqus");
    expect(platformForHost("notyoutube.com")).toBeUndefined();
    expect(platformForHost("evil-x.com")).toBeUndefined();
  });

  test("only YouTube is built in; all match patterns are https and specific", () => {
    expect(PLATFORMS.filter((p) => p.builtin).map((p) => p.id)).toEqual(["youtube"]);
    for (const p of OPTIONAL_PLATFORMS)
      for (const m of p.matches) expect(m).toMatch(/^https:\/\/[a-z0-9.-]+\.[a-z]+\//);
  });

  test("manifest optional_host_permissions mirror platforms.ts", async () => {
    const manifest = await Bun.file("static/manifest.json").json();
    expect([...manifest.optional_host_permissions].sort()).toEqual(OPTIONAL_PLATFORMS.flatMap((p) => p.matches).sort());
    for (const p of PLATFORMS.filter((x) => x.builtin)) for (const m of p.matches) expect(manifest.host_permissions).toContain(m);
  });
});

describe("adapters extract text + author", () => {
  afterEach(() => (document.body.innerHTML = ""));

  for (const [id, f] of Object.entries(FIXTURES)) {
    test(id, () => {
      document.body.innerHTML = f.html;
      const set = adaptersForHost(f.host)!;
      expect(set.platform).toBe(id as PlatformId);
      const containers = [...document.querySelectorAll(set.containers)].filter((el) => adapterFor(el, set));
      expect(containers.length).toBe(1); // nested quoted tweet is skipped
      const { text, author } = extract(containers[0]!, adapterFor(containers[0]!, set)!);
      expect(text.length).toBeGreaterThan(10);
      expect(author.length).toBeGreaterThan(2);
    });
  }
});

describe("scanner on other platforms", () => {
  let scanner: Scanner | undefined;
  afterEach(() => {
    scanner?.stop();
    document.body.innerHTML = "";
  });

  for (const [id, f] of Object.entries(FIXTURES)) {
    test(`${id}: judol spam is blurred`, async () => {
      scanner = new Scanner(document, { classify: async () => [], onAllow: () => {}, adapters: adaptersForHost(f.host) });
      scanner.start(cfg());
      document.body.innerHTML = f.html;
      await tick();
      const marked = document.querySelectorAll("[data-aj-state]");
      expect(marked.length).toBe(1);
      expect(["judol", "suspicious"]).toContain(marked[0]!.getAttribute("data-aj-state")!);
    });
  }

  test("disabled platform is not scanned", async () => {
    scanner = new Scanner(document, { classify: async () => [], onAllow: () => {}, adapters: adaptersForHost("x.com") });
    scanner.start(cfg({ platforms: { ...allPlatforms(false), youtube: true } }));
    document.body.innerHTML = FIXTURES.x.html;
    await tick();
    expect(document.querySelectorAll("[data-aj-state]").length).toBe(0);
  });

  test("unknown host: scanner stays idle", async () => {
    scanner = new Scanner(document, { classify: async () => [], onAllow: () => {}, adapters: adaptersForHost("example.com") });
    scanner.start(cfg());
    document.body.innerHTML = FIXTURES.reddit.html;
    await tick();
    expect(scanner.platform).toBeNull();
    expect(document.querySelectorAll("[data-aj-state]").length).toBe(0);
  });

  test("platform name is sent to Jev", async () => {
    const sent: unknown[] = [];
    scanner = new Scanner(document, {
      classify: async (items) => (sent.push(...items), items.map((i) => ({ key: i.key, verdict: "SAFE" as const, source: "jev" as const, pJudol: 0 }))),
      onAllow: () => {},
      adapters: adaptersForHost("www.reddit.com"),
    });
    scanner.start(cfg({ jevAvailable: true }));
    document.body.innerHTML = FIXTURES.reddit.html;
    await tick(120);
    expect(sent).toContainEqual(expect.objectContaining({ platform: "reddit" }));
  });
});
