# Anti-Judol Real-Time Browser Shield

Ekstensi MV3 (Chrome/Edge) yang mem-blur promosi judi online di komentar, live chat, dan judul video YouTube.
Klasifikasi: **heuristik lokal (<0.1ms/item)** untuk respons instan + **Jev (TypeSafe System One)** sebagai hakim akhir.
Output bertipe `SAFE | JUDOL_PROMO | SUSPICIOUS_SPAM` (`src/shared/verdict.ts`).

## Pakai

```sh
bun install
bun run check        # tsc + 51 test + build → dist/
bun run watch        # dev build dengan sourcemap
```

Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → pilih `dist/`.
Isi TypeSafe API key di halaman Pengaturan (opsional: OpenRouter key sebagai fallback berbayar). Tanpa key, ekstensi tetap jalan dengan filter lokal.

Bun hanya dipakai saat development (bundling/test); browser menjalankan JS biasa hasil build.

## Arsitektur

```
content script (per frame)                       service worker (1 untuk semua tab)
───────────────────────────                      ─────────────────────────────────
MutationObserver ─► normalize ─► skor lokal      Scheduler
  │ (microtask, sebelum paint, budget 8ms/slice)   cache LRU 5000 (session storage)
  ├─ skor ≥ 0.85 → blur SEKARANG                   dedupe in-flight lintas tab
  ├─ skor ≥ 0.5  → blur "Memeriksa…"               priority queue (live chat > judul > komentar)
  └─ lainnya     → IntersectionObserver (600px)    window 30ms / max 24 item per request
                      │                            ≤3 request paralel, jarak ≥100ms
outbox 40ms / ≤48 ───┴──── classify ──────────►    429/529/5xx → backoff eksponensial + Retry-After
                                                   401 → circuit 5 menit → verdict lokal
◄──────────────── verdict final ──────────────     TypeSafe gagal → OpenRouter (jika key diisi)
```

### 1. Batching & performa

- **Sub-50ms dijamin oleh tier lokal**, bukan oleh jaringan. Jev butuh ~260–580ms per round-trip (diukur), jadi spam yang jelas di-blur di microtask MutationObserver, *sebelum* frame pertama tampil. Jev lalu mengonfirmasi atau membatalkannya.
- **Satu request = banyak komentar.** Tiap komentar jadi satu *Choice question* terpisah; Jev menjawab semua question secara paralel. Terukur: 1 item ≈ 380ms, 24 item ≈ 300ms, 48 item ≈ 364ms (median). Teks komentar ditaruh di `instructions` terstruktur tiap question, bukan di `state` bersama, supaya komentar lain tidak jadi distraktor.
- **Hanya yang dekat viewport** dikirim ke Jev (IntersectionObserver). Live chat dan item mencurigakan langsung antre.
- **Tanpa jank:** DOM hanya disentuh lewat `data-*` attribute + satu badge; blur dikerjakan CSS. Scan dipecah per 8ms, sisanya lanjut di task berikutnya. Terukur di happy-dom: 2000 komentar, 0.03ms/item, slice terlama 14ms.
- **Hemat kuota:** cache per teks ter-normalisasi (varian obfuscation yang sama → 1 key), dedupe, skor lokal ≥0.97 tidak dikirim ke Jev, backpressure (queue >400 → item prioritas rendah diputus lokal).

### 2. Normalisasi (`src/shared/normalize.ts`)

Satu pass per karakter + memo:

| Trik | Contoh | Hasil |
|---|---|---|
| Zero-width / bidi / Hangul filler | `g​a​c​o​r` | `gacor` |
| Fullwidth, math bold, circled, squared, regional-indicator | `ｓｌｏｔ` `𝐉𝐔𝐃𝐈𝟖𝟖𝟖` `ⓢⓛⓞⓣ` `🅹🆄🅳🅸` | `slot` `JUDI888` `slot` `JUDI` |
| Zalgo / diakritik | `z̷a̷l̷g̷o̷`, `Café` | `zalgo`, `Cafe` |
| Homoglyph Cyrillic/Yunani (hanya di token campuran Latin) | `Ѕlоt gасоr` | `Slot gacor` |
| Huruf berspasi | `s l o t`, `S.L.O.T` | `slot` |
| Leetspeak (di antara huruf) | `g4c0r`, `m4xw1n` | `gacor`, `maxwin` |
| Domain disamarkan | `kasino310 (dot) com` | `kasino310.com` |
| Huruf diulang | `maxwiiiiin` | `maxwiin` |

Tidak merusak teks sah: `10rb`, `2 hari`, bahasa Rusia/Jepang, emoji tetap utuh. Rasio obfuscation sendiri dipakai sebagai sinyal spam. Heuristik (`heuristics.ts`) memakai *noisy-OR* dari kata inti (gacor, maxwin, togel…), kata promo (depo, wd, bio…), pola brand `nama+angka` (judi888), domain, dan obfuscation; konteks berita/anti-judi menurunkan skor.

### 3. Kontrol pengguna & whitelist

State disimpan di `chrome.storage.local` dan **hanya ditulis oleh service worker** (single writer, tidak ada race antar tab):

- **Resolusi aktif:** `aturan halaman > aturan situs > switch global` (`resolveActive`).
- **Page key** stabil untuk YouTube: `watch?v=ID&t=…`, `m.youtube.com`, dan iframe `live_chat?v=ID` → satu key yang sama.
- **Popup:** toggle halaman ini / situs ini / global, "Tampilkan semua (sementara)" (tidak disimpan, reset saat navigasi), statistik per halaman.
- **Per item:** klik konten yang di-blur → reveal (link judol tidak ikut terbuka); tombol **"Bukan judol"** → key masuk whitelist permanen, semua salinan di halaman ikut dibuka.
- Batas: 500 aturan halaman, 2000 whitelist (LRU berdasarkan waktu).
- Perubahan disiarkan ke semua tab (`config:changed`) dan diterapkan tanpa reload.

## Keamanan

- API key hanya ada di service worker; content script tidak pernah menerimanya (`ContentConfig` tanpa key).
- Pesan pengaturan/key/aturan hanya diterima dari halaman ekstensi (dicek via `sender.url`).
- Permissions minimal: `storage` + host YouTube, `api.typesafe.ai`, `openrouter.ai`. Tidak ada `innerHTML` (aman untuk Trusted Types YouTube).
- Teks komentar yang terlihat dikirim ke TypeSafe (dan OpenRouter bila fallback aktif) untuk diklasifikasi.

## Batasan yang diketahui

- Selector YouTube berubah-ubah; semua ada di `src/content/adapters.ts`.
- Belum diuji end-to-end di Chrome sungguhan; test DOM memakai happy-dom.
- Heuristik lokal hanya untuk bahasa Indonesia/Inggris; Jev menangani kasus bernuansa.
