# Architecture

How Anti-Judol Shield works, for contributors.

Detection has two tiers. An on-device heuristic filter (<0.1 ms per item) acts instantly, and Jev (TypeSafe System One) makes the final call when AI mode is enabled. Verdicts are typed as `SAFE | JUDOL_PROMO | SUSPICIOUS_SPAM` (`src/shared/verdict.ts`).

```
content script (per frame)                      service worker (one for all tabs)
──────────────────────────                      ─────────────────────────────────
MutationObserver ─► normalize ─► local score    Scheduler
  │ (microtask, before paint, 8 ms slices)        LRU cache 5000 (session storage)
  ├─ score ≥ 0.85 → blur now                      in-flight dedupe across tabs
  ├─ score ≥ 0.5  → soft blur "Memeriksa…"        priority queue (chat > titles > comments)
  └─ otherwise    → IntersectionObserver (600px)  30 ms window / ≤24 items per request
                     │                            ≤3 concurrent, ≥100 ms apart
outbox 40 ms / ≤48 ──┴──── classify ─────────►    429/529/5xx → exp. backoff + Retry-After
                                                  401 → 5 min circuit → local verdicts
◄──────────────── final verdict ─────────────     daily limit → local verdicts
                                                  TypeSafe fails → OpenRouter (if key set)
```

| Path | Role |
|---|---|
| `src/shared/normalize.ts` | De-obfuscation pipeline |
| `src/shared/heuristics.ts` | Local scorer |
| `src/shared/decide.ts` | Thresholds per sensitivity; turns scores/probabilities into verdicts |
| `src/content/scanner.ts` | DOM engine: observers, slicing, outbox, marking |
| `src/content/adapters.ts` | YouTube selectors (update these when YouTube changes) |
| `src/background/scheduler.ts` | Batching, cache, dedupe, backoff, backpressure |
| `src/background/jev.ts` | Jev request/response, OpenRouter fallback |
| `src/background/index.ts` | Message router, storage (single writer), quota, `commitSettings()` |
| `src/shared/platforms.ts` | Platform registry (hosts, match patterns, beta flag) |
| `src/background/platforms.ts` | Dynamic content-script registration for opt-in platforms and all-sites mode |
| `src/shared/blocklist.ts`, `src/background/blocking.ts` | Gambling-domain list, protect list, DNR rules |
| `src/content/web.ts`, `src/shared/webscan.ts` | All-sites scanner (banners, iframes, links, hacked pages) |
| `src/shared/report.ts` | aduankonten.id report text |
| `src/shared/portable.ts`, `src/background/sync.ts` | Export/import and Chrome Sync (no secrets) |

## Batching & performance

- **The sub-50 ms goal is met by the local tier, not the network.** A Jev round-trip measured 260–580 ms. Obvious spam is blurred inside the MutationObserver microtask, before the first frame is painted (E2E in Chrome: 0.3 ms to the next `requestAnimationFrame`). Jev then confirms or reverts the local verdict.
- **One request carries many comments.** Each comment becomes its own Choice question, and Jev answers them in parallel. Measured medians: 1 item ≈ 380 ms, 24 items ≈ 300 ms, 48 items ≈ 364 ms. Comment text goes in each question's structured `instructions`, not in a shared `state`, so one comment can't act as a distractor for another.
- **Only items near the viewport go to Jev.** Live chat and suspicious items skip the wait. Background tabs spend no quota.
- **No jank.** The DOM is touched only through `data-*` attributes plus one badge per item, and CSS does the blurring. Scanning runs in 8 ms slices. In happy-dom, 2000 comments took 0.03 ms per item, with a longest slice of 14 ms.
- **Quota savings:**
  - The cache is keyed by normalized text, so all obfuscated variants of a message share one entry.
  - Duplicate in-flight requests are merged.
  - Items with a local score ≥ 0.97 skip Jev.
  - When the queue exceeds 400, low-priority items get local verdicts.
  - A daily item limit applies.

## Normalization

Single pass per character, memoized:

| Trick | Example | Result |
|---|---|---|
| Zero-width / bidi / Hangul filler | `g​a​c​o​r` | `gacor` |
| Fullwidth, math bold, circled, squared, regional indicators | `ｓｌｏｔ` `𝐉𝐔𝐃𝐈𝟖𝟖𝟖` `ⓢⓛⓞⓣ` `🅹🆄🅳🅸` | `slot` `JUDI888` `slot` `JUDI` |
| Zalgo / diacritics | `z̷a̷l̷g̷o̷`, `Café` | `zalgo`, `Cafe` |
| Cyrillic/Greek homoglyphs (only in tokens mixed with Latin) | `Ѕlоt gасоr` | `Slot gacor` |
| Spaced letters | `s l o t`, `S.L.O.T` | `slot` |
| Leetspeak (between letters) | `g4c0r`, `m4xw1n` | `gacor`, `maxwin` |
| Disguised domains | `kasino310 (dot) com` | `kasino310.com` |
| Repeated letters | `maxwiiiiin` | `maxwiin` |

Legitimate text is left intact: `10rb`, `2 hari`, Russian/Japanese text, and emoji all survive. The obfuscation ratio is itself a spam signal. The scorer combines these signals with a noisy-OR:

- core words (gacor, maxwin, togel…)
- promo words (depo, wd, bio…)
- `name+digits` brand names (judi888)
- domains
- the obfuscation ratio

News or anti-gambling context lowers the score.

## User controls & state

State lives in `chrome.storage.local`, and only the service worker writes it, so there are no races between tabs.

- **Precedence:** page rule > site rule > global switch (`resolveActive` in `src/shared/page.ts`).
- **Stable YouTube page keys:** `watch?v=ID&t=…`, `m.youtube.com`, and the `live_chat?v=ID` iframe all map to one key.
- **"Show all"** is a document attribute that is not persisted.
- **Whitelist:** "Bukan judol" stores the item's hash only.
- **Limits:** 500 page rules and 2000 whitelist entries, with the oldest pruned first.
- Changes are broadcast to all tabs and applied without a reload.

## Security model

- Remote classification requires an API key **and** `remoteConsent` (off by default).
- Keys are write-only. They are stored with `storage.local` access level `TRUSTED_CONTEXTS`, so content scripts can't read them, and extension pages only receive a masked hint.
- Endpoints are fixed to `api.typesafe.ai` and `openrouter.ai`. There is no configurable URL.
- Settings, key, and rule messages are only accepted from extension pages (checked via `sender.url`). There is no `externally_connectable`.
- Required permissions:
  - `storage`, `scripting`, `declarativeNetRequest`, `alarms`
  - host access only to YouTube and the two AI APIs.
- Optional, requested only when the user enables a feature:
  - platform hosts
  - `<all_urls>`, the only broad pattern. The package check rejects any other broad pattern.
- A strict extension-page CSP is set. There is no `innerHTML`, `eval`, or remote code. The downloaded blocklist is data, never code.
- Content scripts may only send `classify`, `state:get`, `rule:allow`, and `block:check`. Everything else is `PRIVILEGED` (extension pages only).
- `bun run package` fails if the build contains anything that looks like an API key, an inline sourcemap, or `eval`.

## Platforms

YouTube is built in: its content script and host permission are declared in the manifest. Every other platform is opt-in:

1. The user ticks the platform in Settings.
2. The options page calls `chrome.permissions.request` for that platform's match patterns only.
3. The worker registers a content script with `chrome.scripting.registerContentScripts`, with ids of the form `aj-platform-<id>`.

`syncPlatformScripts()` keeps registrations equal to *enabled ∩ granted*. It runs on start, on every settings change, and on `permissions.onAdded/onRemoved`.

The content script picks its adapter set from `location.hostname`. Adding a platform takes three steps:

1. Add an entry to `PLATFORMS`.
2. Add adapters to `ADAPTERS`.
3. Add its match patterns to `optional_host_permissions`. The package check fails if these drift out of sync.

## Blocking gambling sites

- **Sources:** the HaGeZi Gambling mini list (GPL-3.0, about 142k domains) is downloaded at runtime from jsDelivr every 12 h (`chrome.alarms`). It is never bundled. The last good copy is kept if a download fails or comes back suspiciously small. User block domains are added on top.
- **Exclusions:** the user's allow domains and `PROTECT_SUFFIXES` (`go.id`, `ac.id`, banks, major platforms) are removed. Hacked government and campus sites host judol *pages*, which the all-sites scanner handles. Their domains are never blocked.
- **Rules:** domains are chunked 5,000 per `requestDomains` rule, which comes to 58 dynamic rules for the full list. Chrome enforces them, so the extension never sees navigations. Rule types:
  - Without host access: `block` rules for main frames, subframes, images, and media.
  - With the optional `<all_urls>`: main frames get a `redirect` rule to `blocked.html#<original URL>`, and subresources are still blocked.
- **Warning page actions:**
  - "Buka sekali saja" adds a per-tab session `allow` rule.
  - "Bukan situs judi" adds the domain to the allow list.

## All-sites scanner

This mode is opt-in and needs `<all_urls>`. It is registered for all http(s) pages except platform hosts, in all frames at `document_idle`. It watches `a[href]`, `img`, `iframe`, `embed`, and `object` elements. Signals:

1. Target host on the blocklist. The page asks the worker with `block:check`, batched, and no network is used.
2. Host name looks like a judol site. Labels are segmented into a gambling/filler dictionary (`agenslots77`, `situsjudi`, `slotgacor`). Ambiguous words need a digit or a second gambling or judol-specific word.
3. Banner alt, title, or file name scores as judol.
4. Anchor text scores as judol (SEO spam links).

When an element matches, its whole ad unit (single-child wrappers) is hidden behind a placeholder with **Lihat** and **Laporkan** buttons. A page whose own title, `h1`, or description is judol promo gets a full-page warning. Nothing in this mode is ever sent to the AI.

## Sync, import/export, custom keywords

- `toPortable()` / `fromPortable()` never include API keys. Keys found in an imported file are ignored, and the local keys are kept.
- Sync is opt-in. Data is chunked into `chrome.storage.sync` items of 7 KB each, under 90 KB total. When space runs out, the oldest whitelist entries are dropped first.
- Changes arriving from another device are applied with `commitSettings(next, fromRemote = true)`, which never re-pushes them, so devices don't ping-pong updates.
- Turning sync off removes our items from sync.
- Custom keywords are matched against the same de-obfuscated skeleton as the built-in rules. Allow wins over block.

## Localization

All UI text lives in `static/_locales/{en,id}/messages.json`, and the language follows the browser; English is the fallback. How text is applied:

- HTML elements use `data-i18n="key"` and `data-i18n-attr="placeholder:key"`.
- Code calls `t("key", ...subs)`. Keys are type-checked against the English file.
- `$1`…`$9` are substitutions, and `$$` is a literal `$`.

`tests/i18n.test.ts` checks that:

- both languages define the same keys and placeholders
- every used key exists and every defined key is used
- the store length limits hold
- no Indonesian text is hard-coded in the extension pages

Reports sent to aduankonten.id stay in Indonesian on purpose, because they go to an Indonesian government service.

## Tests

- `bun test`: unit and DOM tests (happy-dom, all network loading disabled) covering:
  - normalization and heuristics
  - scheduler and scanner
  - every platform adapter
  - blocklist and DNR rules
  - the all-sites scanner
  - export/import and sync
  - the safety defaults
- `bun run live`: opens **real** public pages (YouTube, Reddit, X, Twitch) with the extension loaded and reports whether each platform's selectors still find content. It's read-only, with no login. It isn't part of CI, because real sites are slow and can put up consent or login walls. Run it when a platform seems to stop working, or before a release.
- `bun run demo`: re-records `docs/demo.gif` and `docs/screenshot.png` (English) plus the `.id` versions (Indonesian) in a real Chrome (local mode, no API key).
- `bun run e2e`: loads the build into a real Chrome via puppeteer-core.
  - Fixture pages are served at real site URLs through request interception.
  - Optional hosts are pre-granted, because Chrome's permission prompt can't be automated.
  - It covers YouTube, opt-in X, DNR blocking with the real downloaded list, the warning page, all-sites mode, Report, sync, export/import, and both UI languages.
  - Set `TS_KEY=…` to include live Jev checks. The key is passed via env only.
