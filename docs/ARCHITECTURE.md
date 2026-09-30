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
| `src/background/index.ts` | Message router, storage (single writer), quota |

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
- The only permission is `storage`, plus the host permissions. A strict extension-page CSP is set. There is no `innerHTML`, `eval`, or remote code.
- `bun run package` fails if the build contains anything that looks like an API key, an inline sourcemap, or `eval`.

## Tests

- `bun test`: unit and DOM tests (happy-dom) covering normalization, heuristics, scheduler, scanner, and the safety defaults.
- `bun run e2e`: loads `dist/` into a real Chrome via puppeteer-core. YouTube-shaped fixtures are served at real `youtube.com` URLs. Set `TS_KEY=…` to include live Jev checks. The key is passed via env only.
