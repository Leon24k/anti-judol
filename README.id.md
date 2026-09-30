<p align="center">
  <img src="static/icons/icon-128.png" alt="" width="96" height="96" />
</p>

<h1 align="center">Anti-Judol Shield</h1>

<p align="center">
  Otomatis menyembunyikan spam judi online (judol) di komentar, live chat, dan judul video YouTube.<br />
  <a href="README.md">English</a> · <a href="PRIVACY.md">Privasi</a> · <a href="https://github.com/Leon24k/anti-judol/issues">Laporkan masalah</a>
</p>

<p align="center">
  <img src="docs/demo.gif" alt="Demo: saat komentar video YouTube dimuat, spam judi langsung di-blur dengan badge merah. Satu komentar dibuka dengan tombol 'Lihat' lalu ditutup lagi, kemudian popup menampilkan 12 komentar dipindai, 3 judol, 1 spam" width="800" />
</p>

<details>
<summary><b>Screenshot</b></summary>
<p align="center">
  <img src="docs/screenshot.png" alt="Komentar YouTube dengan spam judi di-blur dan diberi label 'Promosi judol' atau 'Spam mencurigakan', di samping popup ekstensi yang menampilkan statistik halaman dan tombol on/off" width="800" />
</p>
</details>

## Kenapa

Kolom komentar YouTube penuh iklan judi seperti "slot gacor", "maxwin", dan "JUDI888". Tulisannya sengaja disamarkan supaya lolos dari filter biasa: `s l o t`, `g4c0r`, `𝐉𝐔𝐃𝐈𝟖𝟖𝟖`, `ｓｌｏｔ`, `kasino310 (dot) com`.

Anti-Judol Shield membongkar penyamaran itu dan mem-blur spamnya sebelum sempat kamu lihat. Komentar biasa tidak disentuh, termasuk komentar yang *membahas* judi, seperti berita atau peringatan.

## Fitur

- **Instan.** Spam yang jelas langsung di-blur sebelum muncul di layar, dan scroll tetap mulus.
- **Tembus penyamaran.** Mengenali huruf berspasi, angka pengganti huruf, font Unicode aneh, huruf kembar dari alfabet lain, karakter tersembunyi, dan link yang disamarkan.
- **Bekerja di komentar, live chat, dan judul video**, di YouTube desktop maupun mobile.
- **Kamu yang pegang kendali:**
  - Klik komentar yang di-blur kalau tetap ingin membacanya.
  - Tombol **"Bukan judol"** memperbaiki salah deteksi supaya komentar itu tidak disembunyikan lagi.
  - Perlindungan bisa dimatikan untuk satu video saja, untuk seluruh YouTube, atau total.
  - **"Tampilkan semua (sementara)"** menampilkan semua komentar di halaman yang sedang dibuka.
- **Privat sejak awal.** Semua berjalan di perangkatmu. Tidak ada data yang dikirim kecuali kamu sendiri yang menyalakan mode AI.
- **Mode AI opsional** memakai [Jev dari TypeSafe](https://typesafe.ai) untuk menangkap spam halus tanpa kata kunci jelas, misalnya "modal receh jadi jutaan, cek profil aku".

## Instalasi

> Segera tersedia di Chrome Web Store.

Sementara itu, pasang manual di Chrome, Edge, Brave, atau browser Chromium lain:

1. Pasang [Bun](https://bun.sh), lalu jalankan:
   ```sh
   git clone https://github.com/Leon24k/anti-judol.git
   cd anti-judol
   bun install
   bun run build
   ```
2. Buka `chrome://extensions` (atau `edge://extensions`).
3. Nyalakan **Developer mode** di pojok kanan atas.
4. Klik **Load unpacked**, lalu pilih folder `dist`.
5. Buka video YouTube mana saja. Spam judi akan langsung di-blur.

## Cara pakai

Klik ikon perisai di toolbar browser untuk:

- melihat jumlah komentar yang diperiksa dan disembunyikan di halaman ini,
- mematikan perlindungan untuk video ini atau untuk seluruh YouTube,
- menampilkan semua komentar untuk sementara.

Di komentar yang di-blur:

- **Lihat** membuka komentarnya, dan **Sembunyikan** menutupnya lagi.
- **Bukan judol** menandai bahwa itu bukan spam judi. Komentar langsung dibuka dan tidak akan disembunyikan lagi.

Pengaturan lain ada di menu **Pengaturan** (klik kanan ikon → *Options*), misalnya pilihan blur atau sembunyikan total, tingkat sensitivitas, dan area yang dipindai.

## Mode AI (opsional)

Filter bawaan sudah menangkap sebagian besar spam. Untuk kasus yang lebih licin, kamu bisa menyalakan klasifikasi AI:

1. Ambil API key dari [TypeSafe](https://console.typesafe.ai).
2. Buka **Pengaturan** ekstensi, tempel key-nya, lalu centang kotak persetujuan.
3. Klik **Tes koneksi Jev** untuk memastikan key-nya berfungsi.

Saat mode AI aktif, teks komentar yang kamu scroll dan nama pengirimnya dikirim ke TypeSafe untuk diperiksa. Tidak ada data lain yang dikirim. Key hanya disimpan di browsermu dan tidak ditampilkan lagi setelah disimpan. Ada batas harian (default 20.000 komentar) supaya pemakaian tetap terkendali. Kamu juga bisa menambahkan key [OpenRouter](https://openrouter.ai) sebagai cadangan kalau TypeSafe sedang tidak bisa diakses. OpenRouter mengenakan biaya kecil per pemakaian.

## Privasi

- Tanpa mode AI, **tidak ada data yang keluar dari komputermu**.
- Tidak ada akun, pelacakan, analitik, maupun server milik kami.
- Ekstensi hanya berjalan di YouTube.

Detail lengkap ada di [kebijakan privasi](PRIVACY.md).

## Tanya jawab

**Komentar biasa ikut ke-blur, gimana?**
Klik **Bukan judol** di komentar itu, dan komentar tersebut tidak akan disembunyikan lagi. Kalau sering terjadi, turunkan sensitivitas di Pengaturan atau [buka issue](https://github.com/Leon24k/anti-judol/issues) dengan contohnya.

**Masih ada spam yang lolos.**
Nyalakan mode AI atau naikkan sensitivitas. Contoh spam yang lolos juga sangat membantu untuk memperbaiki filter bawaan, jadi silakan dilaporkan.

**Bikin YouTube lemot nggak?**
Tidak. Pemeriksaan per komentar butuh kurang dari satu milidetik, dan hanya komentar di dekat layar yang diperiksa.

**Bisa untuk bahasa lain?**
Filter bawaan dirancang untuk spam judi berbahasa Indonesia dan Inggris. Mode AI memahami lebih banyak bahasa.

## Kontribusi

Laporan bug, contoh spam yang lolos, dan pull request sangat diterima. Cara kerja teknisnya dijelaskan di [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```sh
bun install
bun run check   # typecheck + unit test + build
bun run e2e     # tes end-to-end di Chrome asli
```
