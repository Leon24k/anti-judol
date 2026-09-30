<p align="center">
  <img src="static/icons/icon-128.png" alt="" width="96" height="96" />
</p>

<h1 align="center">Anti-Judol Shield</h1>

<p align="center">
  Hides online-gambling ("judol") spam in YouTube comments, live chat, and video titles automatically.<br />
  <a href="README.id.md">Bahasa Indonesia</a> · <a href="PRIVACY.md">Privacy</a> · <a href="https://github.com/Leon24k/anti-judol/issues">Report a problem</a>
</p>

<p align="center">
  <img src="docs/screenshot.png" alt="Gambling spam comments blurred with a red 'Promosi judol' badge, while normal comments stay visible" width="640" />
</p>

## Why

YouTube comment sections, especially in Indonesia, are flooded with gambling ads like "slot gacor", "maxwin", and "JUDI888". Spammers disguise the words so ordinary filters can't catch them: `s l o t`, `g4c0r`, `𝐉𝐔𝐃𝐈𝟖𝟖𝟖`, `ｓｌｏｔ`, `kasino310 (dot) com`.

Anti-Judol Shield undoes those tricks and blurs the spam before you even see it. Normal comments are left alone, including comments that *talk about* gambling, like news or warnings.

## Features

- **Instant.** Obvious spam is blurred before it appears on screen, so scrolling stays smooth.
- **Sees through disguises.** It handles spaced-out letters, numbers in place of letters, fancy Unicode fonts, look-alike letters, hidden characters, and disguised links.
- **Covers comments, live chat, and video titles**, on both desktop and mobile YouTube.
- **You stay in control:**
  - Click a blurred comment to read it anyway.
  - **"Bukan judol"** ("not gambling") marks a false alarm so it's never hidden again.
  - Turn protection on or off for a single video, for all of YouTube, or everywhere.
  - **"Show all (temporary)"** reveals everything on the current page.
- **Private by default.** Everything runs on your device. Nothing is sent anywhere unless you turn on AI mode yourself.
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
5. Open any YouTube video. Gambling spam is blurred automatically.

## Using it

Click the shield icon in your browser toolbar to:

- see how many comments were checked and hidden on the current page,
- turn protection off for the current video or for all of YouTube,
- temporarily show everything.

On a blurred comment:

- **Lihat** ("show") reveals it, and **Sembunyikan** ("hide") covers it again.
- **Bukan judol** means it isn't gambling spam. It's un-hidden and won't be hidden again.

More options, like choosing between blurring and hiding completely, sensitivity, and which areas to scan, are in **Settings** (right-click the icon → *Options*).

## AI mode (optional)

The built-in filter catches most spam. For trickier cases you can enable AI classification:

1. Get an API key from [TypeSafe](https://console.typesafe.ai).
2. Open the extension's **Settings**, paste the key, and tick the consent box.
3. Click **Tes koneksi Jev** ("test connection") to check it works.

When AI mode is on, the text of comments you scroll past, plus the commenter's display name, is sent to TypeSafe to be checked. Nothing else is sent. Your key is stored only in your browser and is never shown again after saving. A daily limit (default 20,000 comments) keeps usage in check. You can optionally add an [OpenRouter](https://openrouter.ai) key as a backup for when TypeSafe is unavailable. OpenRouter charges a small fee per use.

## Privacy

- Without AI mode, **no data leaves your computer**.
- There are no accounts, no tracking, no analytics, and no servers run by us.
- The extension only runs on YouTube.

Full details are in the [privacy policy](PRIVACY.md).

## FAQ

**A normal comment got blurred. What do I do?**
Click **Bukan judol** on it. That comment won't be hidden again. If it keeps happening, lower the sensitivity in Settings or [open an issue](https://github.com/Leon24k/anti-judol/issues) with an example.

**Some spam still gets through.**
Turn on AI mode or raise the sensitivity. Please also report examples so the built-in filter can improve.

**Does it slow down YouTube?**
No. Checking a comment takes a fraction of a millisecond, and only comments near your screen are checked.

**Does it work in other languages?**
The built-in filter is tuned for Indonesian and English gambling spam. AI mode understands more languages.

## Contributing

Bug reports, missed-spam examples, and pull requests are welcome. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it works.

```sh
bun install
bun run check   # typecheck + unit tests + build
bun run e2e     # end-to-end test in a real Chrome
```

YouTube changes its page structure from time to time. If the extension suddenly stops working, the selectors in `src/content/adapters.ts` usually need an update.
