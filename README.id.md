<p align="center">
  <img src="public/logo.png" width="96" alt="BubType logo" />
</p>

<h1 align="center">BubType Community</h1>

<p align="center">
  <a href="./README.md">简体中文</a> ·
  <a href="./README.en.md">English</a> ·
  <a href="./README.zh-TW.md">繁體中文</a> ·
  <a href="./README.ja.md">日本語</a> ·
  <a href="./README.vi.md">Tiếng Việt</a> ·
  <strong>Bahasa Indonesia</strong>
</p>

<p align="center"><strong>Setiap ketukan, sedikit kemajuan bahasa Inggris.</strong></p>

<p align="center">Latihan English desktop open-source · caption mengambang · dikte & review · bunyi tombol dan efek</p>

<p align="center">
  <a href="#pengalaman">Pengalaman</a> ·
  <a href="#edisi">Edisi</a> ·
  <a href="#pengembangan">Pengembangan</a> ·
  <a href="https://bubtype.com">Situs</a> ·
  <a href="https://bubtype.com">BubType Pro</a> ·
  <a href="./LICENSE">Apache-2.0</a>
</p>

---

BubType menyatukan mengetik, dikte, kamus, dan review. Pilih kalimat, dengarkan, ketik; ketuk kata untuk arti dan simpan. Caption mengambang tetap di desktop.

Repositori ini **BubType Community** (Apache-2.0). Produk lengkap: [bubtype.com](https://bubtype.com).

## Pengalaman

### Mulai dari satu kalimat

- **Ketik / dikte / isian**.
- **Tempo Anda** — kecepatan, ulang, terjemahan, IPA.
- **Konten familiar** — paket adegan, buku kata, antrean sendiri.

### Dari kamus ke review

- **Ketuk untuk arti**.
- **Buku kata Anda**.
- **Review berjarak**.
- **Lihat progres**.

### Menempel di desktop

- **Caption mengambang** — posisi, ukuran, font, warna, opacity.
- **Umpan balik** — bunyi dasar, partikel Classic, combo.
- **Tray & hotkey**.
- **Bahasa UI** di pengaturan app; bahasa dokumen di tautan atas.

## Edisi

Community adalah build OSS. Free / Pro di situs adalah build komersial.

| Fitur | Community | Free | Pro |
| --- | --- | --- | --- |
| Latihan & review | Ya | Ya | Ya |
| Caption, kamus, simpan | Ya | Ya | Ya |
| TTS sistem / Piper | Ya | Ya | Ya |
| Classic & bunyi dasar | Ya | Ya | Ya |
| Paket visual & bunyi ekstra | — | — | Ya |
| Ekspor Excel dasar | Ya | Ya | Ya |
| Excel contoh & PDF | — | — | Ya |
| Buka lisensi | — | Naik ke Pro | Aktif |

Selengkapnya: [bubtype.com](https://bubtype.com)

## Pengembangan

### Persiapan

- Windows x64.
- Node.js `22.12+` dan npm.
- Rust stable — [rust-toolchain.toml](rust-toolchain.toml).
- MSVC, Windows SDK, WebView2.

### Jalankan

```powershell
npm ci
npm run tauri -- dev --config src-tauri/tauri.community.conf.json
```

Frontend saja: `npm run dev` → `http://localhost:1420`.

### Build

```powershell
npm run build
npm run tauri -- build --config src-tauri/tauri.community.conf.json
```

## Kontribusi

Issue / PR diterima. Batasi perubahan pada permukaan Community.

## Lisensi

[Apache License 2.0](./LICENSE). Pihak ketiga mengikuti lisensi masing-masing.
