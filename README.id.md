# Anti-Judol Shield (Bahasa Indonesia)

[English](README.md) · [Kebijakan privasi](PRIVACY.md)

Ekstensi Chrome/Edge yang mem-blur promosi judi online di komentar, live chat, dan judul video YouTube.
Filter lokal bekerja instan di perangkat, lalu Jev AI (TypeSafe) memberi keputusan akhir. Hasilnya berupa salah satu dari `SAFE`, `JUDOL_PROMO`, atau `SUSPICIOUS_SPAM`.

## Cara pakai

```sh
bun install
bun run check      # typecheck + test + build → dist/
bun run e2e        # tes di Chrome asli (tambahkan TS_KEY=… untuk tes Jev live)
bun run package    # zip siap upload ke Chrome Web Store
```

1. Buka `chrome://extensions`, nyalakan Developer mode, klik **Load unpacked**, lalu pilih `dist/`.
2. Tanpa pengaturan apa pun, ekstensi langsung jalan dengan filter lokal dan **tidak mengirim data apa pun**.
3. Untuk mengaktifkan Jev, buka Pengaturan, isi TypeSafe API key, lalu centang persetujuan pengiriman teks.

## Fitur utama

- **Normalisasi obfuscation:** mengenali trik seperti `s l o t`, `g4c0r`, `ｓｌｏｔ`, `𝐉𝐔𝐃𝐈𝟖𝟖𝟖`, homoglyph Cyrillic, zero-width, dan `kasino310 (dot) com`.
- **Batching:** satu request ke Jev bisa berisi sampai 24 komentar, dengan waktu ±300–380ms per request. Ada juga cache, dedupe, backoff saat rate limit, dan batas harian.
- **Kontrol pengguna:**
  - Toggle per halaman, per situs, dan global.
  - Opsi "Tampilkan semua" yang berlaku sementara.
  - Klik untuk melihat konten yang di-blur.
  - Tombol **Bukan judol** untuk whitelist permanen.
- **Keamanan:**
  - Pengiriman ke API mati secara default.
  - API key tidak bisa dibaca content script dan tidak pernah ditampilkan ulang.
  - Endpoint tetap: hanya `api.typesafe.ai` dan `openrouter.ai`.

Detail arsitektur, keamanan, dan cara publish ke Chrome Web Store ada di [README.md](README.md).
