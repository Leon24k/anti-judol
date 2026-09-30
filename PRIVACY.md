# Privacy Policy — Anti-Judol Shield

_Last updated: 2026-09-30_

Anti-Judol Shield is a browser extension that hides online-gambling ("judol") promotion in YouTube comments, live chat, and video titles.

## Summary

- **By default, nothing leaves your device.** Detection runs locally with an on-device filter.
- Cloud classification is **off by default** and only runs if you (1) enter your own API key and (2) tick the consent checkbox in Settings.
- We (the developers) run no servers and receive **no data at all**.

## What is processed

| Data | Where | When |
|---|---|---|
| Text of YouTube comments, live-chat messages, and video titles visible on the page, plus the sender's display name | Your device (always) | While the extension is active on youtube.com |
| The same text and display name | Sent to `api.typesafe.ai` (TypeSafe Jev), and to `openrouter.ai` only if you entered an OpenRouter fallback key | Only after you enable cloud classification |

No URLs, browsing history, cookies, account information, IP-derived identifiers, or other page content are collected or sent by the extension. The requests go directly from your browser to the provider using **your** API key; they are subject to that provider's privacy policy:

- TypeSafe: <https://docs.typesafe.ai/legal>
- OpenRouter: <https://openrouter.ai/privacy>

## What is stored (on your device only)

Stored in `chrome.storage.local`, which is not accessible to websites or content scripts:

- Your settings and API key(s)
- Per-page / per-site on-off rules
- Hashes of comments you marked "Bukan judol" (not the text itself)
- A daily counter of how many items were sent (for the daily limit)

A short-lived cache of classification results (keyed by a hash of the text) is kept in memory/session storage and is cleared when the browser restarts. Uninstalling the extension deletes all of it. You can also clear the whitelist and cache from Settings at any time.

## Sharing and sale

The developers do not collect, sell, share, or transfer user data. Data is not used for advertising, creditworthiness, or any purpose other than the single purpose of the extension: detecting and hiding gambling promotion.

## Permissions

- `storage`: save your settings on your device.
- `https://www.youtube.com/*`, `https://m.youtube.com/*`: read visible comments/titles/chat to detect gambling spam.
- `https://api.typesafe.ai/*`, `https://openrouter.ai/*`: send text for classification, only when you enable it.

## Contact

Open an issue at <https://github.com/Leon24k/anti-judol/issues>.
