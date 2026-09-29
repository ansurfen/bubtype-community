<p align="center">
  <img src="public/logo.png" width="96" alt="BubType logo" />
</p>

<h1 align="center">BubType Community</h1>

<p align="center">
  <a href="./README.md">简体中文</a> ·
  <strong>English</strong> ·
  <a href="./README.zh-TW.md">繁體中文</a> ·
  <a href="./README.ja.md">日本語</a> ·
  <a href="./README.vi.md">Tiếng Việt</a> ·
  <a href="./README.id.md">Bahasa Indonesia</a>
</p>

<p align="center"><strong>Make every keystroke a little progress.</strong></p>

<p align="center">Open-source desktop English practice · floating captions · dictation & review · keysound and visuals</p>

<p align="center">
  <a href="#experience">Experience</a> ·
  <a href="#editions">Editions</a> ·
  <a href="#develop">Develop</a> ·
  <a href="https://bubtype.com">Website</a> ·
  <a href="https://bubtype.com">BubType Pro</a> ·
  <a href="./LICENSE">Apache-2.0</a>
</p>

---

BubType turns typing, dictation, lookup, and review into one practice loop. Pick sentences, listen, type them out; tap words to look them up and save them for later. A floating caption stays on your desktop, with keysound, particles, and combo feedback.

This repository is **BubType Community** (Apache-2.0). Build and share it yourself. For the full product line, see [bubtype.com](https://bubtype.com).

## Experience

### Start from a sentence

- **Type, dictate, or fill blanks** — switch modes as you like.
- **Practice at your pace** — speed, replay, gloss, IPA, auto-next.
- **Use content you know** — scene packs, installed books, or your own queue.

### Turn lookups into review

- **Tap to look up** without leaving the caption.
- **Build your wordbook** — words, phrases, and sentences.
- **Spaced review** for what still needs work.
- **See progress** — time, accuracy, volume, combos, calendar.

### Stay on the desktop

- **Floating caption** — place, size, font, color, opacity, toolbar.
- **Instant feedback** — basic keysound, Classic particles, combo.
- **Tray & hotkeys** to show and control practice.
- **UI languages** — switch in app settings; docs languages are linked above.

## Editions

Community is the open-source build. Free / Pro on the website are commercial builds; see the site for details.

| Feature | Community (this repo) | Free | Pro |
| --- | --- | --- | --- |
| Type / dictate / blanks & review | Yes | Yes | Yes |
| Floating caption, lookup, bookmarks | Yes | Yes | Yes |
| System TTS / optional Piper | Yes | Yes | Yes |
| Classic visuals & basic keysound | Yes | Yes | Yes |
| Extra visual & sound packs | — | — | Yes |
| Basic Excel export | Yes | Yes | Yes |
| Excel examples & PDF export | — | — | Yes |
| License unlock | — | Upgrade to Pro | Active |

Learn more: [bubtype.com/about/](https://bubtype.com/about/)

## Develop

### Prerequisites

- Windows x64 (primary target today).
- Node.js `22.12+` and npm (Vite also supports Node `20.19+`).
- Rust stable — see [rust-toolchain.toml](rust-toolchain.toml).
- MSVC C++ tools, Windows SDK, and WebView2 Runtime.

### Run

```powershell
npm ci
npm run tauri -- dev --config src-tauri/tauri.community.conf.json
```

Front-end only: `npm run dev` → `http://localhost:1420`. Browser preview lacks tray, global hotkeys, and desktop TTS.

### Build

```powershell
npm run build
npm run tauri -- build --config src-tauri/tauri.community.conf.json
```

## Contributing

Issues and PRs welcome. Keep changes on the Community surface; do not add commercial-only assets or license unlock code here.

## License

[Apache License 2.0](./LICENSE). Third-party code, fonts, and audio follow their own licenses.
