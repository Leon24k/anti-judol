<p align="center">
  <img src="static/icons/icon-128.png" alt="" width="96" height="96" />
</p>

<h1 align="center">Anti-Judol Shield</h1>

<p align="center">
  Hides online-gambling ("judol") spam in YouTube comments and across the web, and blocks gambling sites.<br />
  <a href="README.id.md">Bahasa Indonesia</a> · <a href="PRIVACY.md">Privacy</a> · <a href="https://github.com/Leon24k/anti-judol/issues">Report a problem</a>
</p>

<p align="center">
  <img src="docs/demo.gif" alt="Demo: as comments load on a YouTube video, gambling spam is blurred instantly with a red badge. One is revealed with the 'Lihat' button and hidden again, then the toolbar popup shows 12 comments scanned, 3 gambling, 1 suspicious" width="800" />
</p>

<details>
<summary><b>Screenshot</b></summary>
<p align="center">
  <img src="docs/screenshot.png" alt="YouTube comments with gambling spam blurred and labelled 'Promosi judol' or 'Spam mencurigakan', next to the extension popup showing page statistics and on/off switches" width="800" />
</p>
</details>

## Why

YouTube comment sections, especially in Indonesia, are flooded with gambling ads like "slot gacor", "maxwin", and "JUDI888". Spammers disguise the words so ordinary filters can't catch them: `s l o t`, `g4c0r`, `𝐉𝐔𝐃𝐈𝟖𝟖𝟖`, `ｓｌｏｔ`, `kasino310 (dot) com`.

Anti-Judol Shield undoes those tricks and blurs the spam before you even see it. Normal comments are left alone, including comments that *talk about* gambling, like news or warnings.

## Features

- **Instant.** Obvious spam is blurred before it appears on screen, so scrolling stays smooth.
- **Sees through disguises.** It handles spaced-out letters, numbers in place of letters, fancy Unicode fonts, look-alike letters, hidden characters, and disguised links.
- **Covers comments, live chat, and video titles**, on both desktop and mobile YouTube.
- **Works beyond YouTube.** Optionally also on X, Reddit, Twitch, Disqus comment sections, and (beta) Facebook, Instagram, and TikTok.
- **Blocks gambling websites.** Over 140,000 known judol domains are stopped before they load, with a clear warning page instead.
- **Cleans up ordinary websites (optional).** Hides gambling banners, ad iframes, and spam links on news sites, streaming sites, and blogs, and warns you when a site has been hacked to promote gambling.
- **Report in one click.** **Laporkan** prepares a ready-to-paste report for [aduankonten.id](https://aduankonten.id), the Indonesian government's content complaint service.
- **You stay in control:**
  - Click a blurred comment to read it anyway.
  - **"Bukan judol"** ("not gambling") marks a false alarm so it's never hidden again.
  - Turn protection on or off for a single video, for all of YouTube, or everywhere.
  - **"Show all (temporary)"** reveals everything on the current page.
  - Add your own words to always hide or never hide.
  - Export/import your settings, or sync them across your computers through Chrome.
- **Private by default.** Everything runs on your device. Nothing about you is sent anywhere unless you turn on AI mode yourself.
- **Optional AI mode** using [Jev by TypeSafe](https://typesafe.ai) catches subtler spam that doesn't use obvious keywords, such as "modal receh jadi jutaan, cek profil aku".

## Install

> Chrome Web Store listing: coming soon.

Until then you can install it manually in Chrome, Edge, Brave, or another Chromium browser:

1. Install [Bun](https://bun.sh), then run:
   ```sh
   git clone https://github.com/Leon24k/anti-judol.git
   cd anti-judol
   bun install
   bun run build
   ```
2. Open `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode** (top-right corner).
4. Click **Load unpacked** and select the `dist` folder.
5. Open any YouTube video. Gambling spam is blurred automatically, and known gambling sites are blocked.

## Using it

Click the shield icon in your browser toolbar to:

- see how many comments were checked and hidden on the current page,
- turn protection off for the current video or for all of YouTube,
- temporarily show everything.

On a blurred comment:

- **Lihat** ("show") reveals it, and **Sembunyikan** ("hide") covers it again.
- **Bukan judol** means it isn't gambling spam. It's un-hidden and won't be hidden again.
- **Laporkan** copies a report (link, the comment, and when you saw it) and opens aduankonten.id. Paste it into the form and submit. Nothing is sent automatically.

More options, like choosing between blurring and hiding completely, sensitivity, and which areas to scan, are in **Settings** (right-click the icon → *Options*).

## Beyond YouTube

All of these are in **Settings**. Chrome asks for permission for each one when you switch it on, and you can revoke it any time.

- **Other platforms.** Under **Platform**, tick X, Reddit, Twitch, Disqus, Facebook, Instagram, or TikTok. Chrome only asks for access to that one site. Reload any tabs of that site that are already open.
- **Gambling-site blocking** is on by default. It uses the community-maintained [HaGeZi Gambling list](https://github.com/hagezi/dns-blocklists), refreshed every 12 hours, and you can add your own domains. Government, campus, bank, and major-platform sites are never blocked, even if a list is wrong. If a site is blocked by mistake, choose **Ini bukan situs judi?** on the warning page.
- **All sites.** Switch on **Sembunyikan iklan, banner & link judi di semua situs** to clean up gambling ads everywhere. This needs permission for all sites. The checking is done entirely on your device: page content is never sent anywhere, not even in AI mode. It also turns the blocked-site error screen into a friendly warning page.

## AI mode (optional)

The built-in filter catches most spam. For trickier cases you can enable AI classification:

1. Get an API key from [TypeSafe](https://console.typesafe.ai).
2. Open the extension's **Settings**, paste the key, and tick the consent box.
3. Click **Tes koneksi Jev** ("test connection") to check it works.

When AI mode is on, the text of comments you scroll past, plus the commenter's display name, is sent to TypeSafe to be checked. Nothing else is sent. Your key is stored only in your browser and is never shown again after saving. A daily limit (default 20,000 comments) keeps usage in check. You can optionally add an [OpenRouter](https://openrouter.ai) key as a backup for when TypeSafe is unavailable. OpenRouter charges a small fee per use.

## Privacy

- Without AI mode, **nothing about you leaves your computer**. The only automatic download is the public list of gambling domains.
- There are no accounts, no tracking, no analytics, and no servers run by us.
- The extension runs on YouTube, plus only the sites you enable. Blocking is done by Chrome itself, so the extension never sees which sites you visit.

Full details are in the [privacy policy](PRIVACY.md).

## FAQ

**A normal comment got blurred. What do I do?**
Click **Bukan judol** on it. That comment won't be hidden again. If it keeps happening, lower the sensitivity in Settings or [open an issue](https://github.com/Leon24k/anti-judol/issues) with an example.

**Some spam still gets through.**
Turn on AI mode or raise the sensitivity. Please also report examples so the built-in filter can improve.

**Does it slow down YouTube?**
No. Checking a comment takes a fraction of a millisecond, and only comments near your screen are checked.

**Why does it want access to "all sites"?**
It doesn't, unless you switch on the all-sites option. YouTube works without it, and the other platforms each ask only for their own site. Blocking gambling sites works without it too; you just see Chrome's error screen instead of the warning page.

**A normal website got blocked.**
Open **Ini bukan situs judi?** on the warning page and choose **Bukan situs judi, jangan blokir lagi**. You can also add it under **Jangan pernah blokir** in Settings. Please [report it](https://github.com/Leon24k/anti-judol/issues) so the list can be fixed.

**Does it work in other languages?**
The built-in filter is tuned for Indonesian and English gambling spam. AI mode understands more languages.

## Contributing

Bug reports, missed-spam examples, and pull requests are welcome. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it works.

```sh
bun install
bun run check   # typecheck + unit tests + build
bun run e2e     # end-to-end test in a real Chrome
```

Websites change their page structure from time to time. If the extension suddenly stops working on a site, the selectors for that platform in `src/content/adapters.ts` usually need an update.

## License

[MIT](LICENSE). The gambling-domain list is downloaded at runtime from [HaGeZi's DNS blocklists](https://github.com/hagezi/dns-blocklists) (GPL-3.0) and is not part of this repository.
