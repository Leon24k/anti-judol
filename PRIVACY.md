# Privacy Policy: Anti-Judol Shield

_Last updated: 2026-09-30_

Anti-Judol Shield is a browser extension that hides online-gambling ("judol") promotion. It works on YouTube and on other sites you choose, and it blocks known gambling websites.

## Summary

- **Detection runs on your device.** Comments, pages, and the sites you visit are checked locally.
- **Nothing about you is sent anywhere by default.** The only automatic download is a public list of gambling domains. Downloading it sends nothing about you.
- **Optional features that send data only work after you turn them on:**
  - AI mode, which requires your own API key and a consent checkbox.
  - Chrome Sync.
- We (the developers) run no servers and receive **no data at all**.

## What is processed, and where

| Feature | Data | Leaves your device? |
|---|---|---|
| Comment filter (YouTube, and other platforms you enable) | Text and sender name of visible comments, live-chat messages, and titles | No |
| Gambling-site blocking | Addresses of pages you open. Chrome matches them against the blocklist itself, and the extension never sees them. | No |
| Blocklist updates | A download of a public domain list from `cdn.jsdelivr.net` about every 12 hours. No personal data is included. Like any web request, it reveals your IP address to jsDelivr. | Download only |
| All-sites mode (optional) | Links, image addresses, and alt text of banners on pages you visit, plus page titles | No, and never sent to AI |
| AI mode (optional) | Text and sender name of visible comments, live-chat messages, and titles, on supported platforms only | Yes, to `api.typesafe.ai`, and to `openrouter.ai` if you set a fallback key |
| Chrome Sync (optional) | Your settings, site rules, whitelist hashes, and custom keywords. **Never API keys.** | Yes, to your own Google account via Chrome Sync |
| "Laporkan" (report) | A report text copied to your clipboard. aduankonten.id then opens for you to paste and submit yourself. | Only if you submit it |

AI requests go directly from your browser to the provider, using **your** API key. They are covered by that provider's privacy policy:

- TypeSafe: <https://docs.typesafe.ai/legal>
- OpenRouter: <https://openrouter.ai/privacy>

The extension never collects or sends your browsing history, cookies, account information, or form contents.

## What is stored on your device

The following is kept in `chrome.storage.local`, which websites and content scripts cannot read:

- settings and API keys
- on/off rules per page and per site
- hashes of comments you marked "Bukan judol" (not the text itself)
- your custom keywords and domains
- the downloaded blocklist
- a daily usage counter

A short-lived cache of classification results, keyed by a hash of the text, is cleared when the browser restarts.

Uninstalling the extension deletes all of this. You can also clear the whitelist, the cache, and synced data from Settings at any time.

## Sharing and sale

The developers do not collect, sell, share, or transfer user data. Data is not used for advertising, for creditworthiness, or for any purpose other than detecting, hiding, and blocking gambling promotion.

## Permissions

- `storage`: save your settings on your device.
- `scripting`: run the filter on the extra platforms you enable.
- `declarativeNetRequest`: let Chrome block known gambling sites without the extension seeing your browsing.
- `alarms`: refresh the blocklist periodically.
- `https://www.youtube.com/*`, `https://m.youtube.com/*`: read visible comments, titles, and chat.
- `https://api.typesafe.ai/*`, `https://openrouter.ai/*`: optional AI classification.
- Optional, and only requested when you turn the feature on:
  - X, Reddit, Twitch, Disqus, Facebook, Instagram, TikTok: filter comments on that platform.
  - "All sites": hide gambling ads and show a warning page instead of blocked sites.

## Contact

Open an issue at <https://github.com/Leon24k/anti-judol/issues>.
