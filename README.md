# Anti-Judol Real-Time Browser Shield

[Bahasa Indonesia](README.id.md) · [Privacy policy](PRIVACY.md)

A Manifest V3 extension for Chrome and Edge that blurs online-gambling ("judol") promotion in YouTube comments, live chat, and video titles.
Detection has two tiers. An **on-device heuristic** filter (<0.1 ms per item) acts instantly, and **Jev (TypeSafe System One)** makes the final call.
Verdicts are typed as `SAFE | JUDOL_PROMO | SUSPICIOUS_SPAM` (`src/shared/verdict.ts`).

## Quick start

```sh
bun install
bun run check      # typecheck + 57 unit tests + build → dist/
bun run e2e        # real-Chrome smoke test (add TS_KEY=… to include live Jev checks)
bun run package    # check + validate + anti-judol-<version>.zip for store upload
```

To load it: open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select `dist/`.
The extension works out of the box with the local filter and **sends nothing**. For AI classification, open Settings, paste your TypeSafe API key, and tick the consent box. You can also add an OpenRouter key as a paid fallback.

Bun is only used at development time for bundling and tests. The browser runs the plain JS produced by the build.

## Architecture

```
content script (per frame)                      service worker (one for all tabs)
──────────────────────────                      ─────────────────────────────────
MutationObserver ─► normalize ─► local score    Scheduler
  │ (microtask, before paint, 8 ms slices)        LRU cache 5000 (session storage)
  ├─ score ≥ 0.85 → blur NOW                      in-flight dedupe across tabs
  ├─ score ≥ 0.5  → soft blur "Memeriksa…"        priority queue (chat > titles > comments)
  └─ otherwise    → IntersectionObserver (600px)  30 ms window / ≤24 items per request
                     │                            ≤3 concurrent, ≥100 ms apart
outbox 40 ms / ≤48 ──┴──── classify ─────────►    429/529/5xx → exp. backoff + Retry-After
                                                  401 → 5 min circuit → local verdicts
◄──────────────── final verdict ─────────────     daily limit → local verdicts
                                                  TypeSafe fails → OpenRouter (if key set)
```

### 1. Batching & performance

- **The sub-50 ms goal is met by the local tier, not the network.** A Jev round-trip measured 260–580 ms. Obvious spam is blurred inside the MutationObserver microtask, before the first frame is painted (E2E in Chrome: 0.3 ms to the next `requestAnimationFrame`). Jev then confirms or reverts the local verdict.
- **One request carries many comments.** Each comment becomes its own Choice question, and Jev answers all questions in parallel. Measured medians: 1 item ≈ 380 ms, 24 items ≈ 300 ms, 48 items ≈ 364 ms. Comment text goes in each question's structured `instructions`, not in a shared `state`, so one comment can't act as a distractor for another.
- **Only items near the viewport go to Jev** (IntersectionObserver). Live chat and suspicious items skip the wait. Background tabs spend no quota.
- **No jank.** The DOM is touched only through `data-*` attributes plus one badge per item, and CSS does the blurring. Scanning runs in 8 ms slices. In happy-dom, 2000 comments took 0.03 ms per item, with a longest slice of 14 ms.
- **Quota savings:** the cache is keyed by normalized text, so all obfuscated variants of one message share a key. Other savings come from dedupe, skipping Jev when the local score is ≥ 0.97, backpressure (when the queue exceeds 400, low-priority items get local verdicts), and a daily item limit (default 20,000).

### 2. Normalization (`src/shared/normalize.ts`)

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

Legitimate text is left intact: `10rb`, `2 hari`, Russian/Japanese text, and emoji all survive. The obfuscation ratio is itself used as a spam signal. The heuristic scorer (`heuristics.ts`) combines signals with a noisy-OR: core words (gacor, maxwin, togel…), promo words (depo, wd, bio…), `name+digits` brands (judi888), domains, and obfuscation. News or anti-gambling context lowers the score.

### 3. User controls & whitelist

State lives in `chrome.storage.local`, and **only the service worker writes it**. Having a single writer means there are no races between tabs.

- **Precedence:** page rule > site rule > global switch (`resolveActive`).
- **Stable YouTube page keys:** `watch?v=ID&t=…`, `m.youtube.com`, and the `live_chat?v=ID` iframe all map to one key.
- **Popup:** toggles for this page, this site, and global. "Show all (temporary)" is not persisted and resets on navigation. Also shows per-page stats.
- **Per item:** clicking blurred content reveals it, and a gambling link inside it is not followed. **"Bukan judol"** adds the item to a persistent whitelist and unblurs every copy on the page.
- **Limits:** 500 page rules and 2000 whitelist entries, with the oldest pruned first.
- Changes are broadcast to all tabs and applied without a reload.

## Security & privacy

- **Nothing leaves the device by default.** Remote classification requires both an API key and an explicit consent checkbox (`remoteConsent`, off by default).
- **API keys are write-only.** They are stored in `chrome.storage.local` with access level `TRUSTED_CONTEXTS`, so content scripts can't read them. The UI only ever receives a masked hint (`…e9f3`).
- **Fixed endpoints:** the only hosts that ever receive a key are `api.typesafe.ai` and `openrouter.ai`. There is no user-configurable URL.
- **Messages:** settings, key, and rule messages are only accepted from extension pages (checked via `sender.url`). There is no `externally_connectable`, so YouTube's own scripts can't talk to the extension.
- **Minimal surface:** the only permission is `storage`, plus the host permissions above. A strict extension-page CSP is set. There is no `innerHTML`, `eval`, or remote code.
- `bun run package` fails if the build contains anything that looks like an API key, an inline sourcemap, or `eval`.

What is sent when the user enables it is the visible comment, title, or chat text plus the sender's display name, and nothing else. See [PRIVACY.md](PRIVACY.md).

## Publishing to the Chrome Web Store

1. Run `bun run package`, then upload `anti-judol-<version>.zip` in the [Developer Dashboard](https://chrome.google.com/webstore/devconsole). Registration is a one-time US$5 fee.
2. Fill in the listing: description, at least one 1280×800 screenshot, and the 128 px icon (`static/icons/icon-128.png`).
3. Fill in the Privacy tab:
   - **Single purpose:** "Hide online-gambling promotion on YouTube".
   - **Permission justifications:** `storage` saves settings. The YouTube hosts are needed to read the visible comments to scan. The TypeSafe and OpenRouter hosts are optional classification APIs.
   - **Data usage:** declare "Website content", sent only with user consent.
   - **Privacy policy URL:** `https://github.com/Leon24k/anti-judol/blob/main/PRIVACY.md`.
4. The same zip works for [Edge Add-ons](https://partner.microsoft.com/dashboard/microsoftedge), which is free.

Never ship your own API key inside the extension. Anyone can unzip it and read the key. Each user brings their own key.

## Known limitations

- YouTube renames its components often. All selectors live in `src/content/adapters.ts`.
- E2E tests use YouTube-shaped fixtures served at real `youtube.com` URLs, not live YouTube, so selector drift on the real site still needs manual checks.
- The local heuristics cover Indonesian and English. Jev handles nuanced cases.
