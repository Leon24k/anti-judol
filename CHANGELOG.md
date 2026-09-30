# Changelog

## 1.1.0

First public release.

**Detection**
- Blurs online-gambling spam in YouTube comments, live chat, and video titles before it appears on screen.
- Sees through disguises: spaced letters, digits for letters, fancy Unicode fonts, look-alike letters, hidden characters, and "(dot) com" links.
- Optional AI mode with Jev by TypeSafe (your own API key, explicit consent, daily limit), with OpenRouter as an optional fallback.

**Beyond YouTube**
- Opt-in support for X, Reddit, Twitch, and Disqus, plus Facebook, Instagram, and TikTok (beta). Each platform asks only for its own site permission.
- Blocks over 140,000 known gambling domains, using the HaGeZi Gambling list refreshed every 12 hours. Government, campus, bank, and major-platform sites are never blocked.
- Optional all-sites mode: hides gambling banners, ad iframes, and spam links on any website, and warns about hacked pages. All checks run on your device.

**Controls**
- Show, "Not gambling", and Report buttons on every flagged item. Report prepares a ready-to-paste report for aduankonten.id.
- On/off per page, per site, and globally, plus a temporary "show everything".
- Custom keywords to always block or never flag. Settings export/import and opt-in Chrome Sync; API keys are never exported or synced.
- English and Indonesian UI, following the browser language.
