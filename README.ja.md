<p align="center">
  <img src="public/logo.png" width="96" alt="BubType logo" />
</p>

<h1 align="center">BubType Community</h1>

<p align="center">
  <a href="./README.md">简体中文</a> ·
  <a href="./README.en.md">English</a> ·
  <a href="./README.zh-TW.md">繁體中文</a> ·
  <strong>日本語</strong> ·
  <a href="./README.vi.md">Tiếng Việt</a> ·
  <a href="./README.id.md">Bahasa Indonesia</a>
</p>

<p align="center"><strong>一打ごとに、少しずつ英語を。</strong></p>

<p align="center">オープンソースのデスクトップ英語練習 · フローティング字幕 · ディクテと復習 · キー音と演出</p>

<p align="center">
  <a href="#体験">体験</a> ·
  <a href="#エディション">エディション</a> ·
  <a href="#開発">開発</a> ·
  <a href="https://bubtype.com">サイト</a> ·
  <a href="https://bubtype.com">BubType Pro</a> ·
  <a href="./LICENSE">Apache-2.0</a>
</p>

---

BubType はタイピング・ディクテ・単語調べ・復習を一本の練習にまとめます。文を選び、聞いて、打ち、単語を調べて保存。フローティング字幕でデスクトップ上に残せます。

このリポジトリは **BubType Community**（Apache-2.0）です。製品全体は [bubtype.com](https://bubtype.com) を参照してください。

## 体験

### 一文から

- **タイピング / ディクテ / 穴埋め**を切り替え。
- **自分のペースで** — 速度、再生、訳、IPA、自動次へ。
- **慣れた教材で** — シーンパック、単語帳、自作キュー。

### 調べた語を復習へ

- **タップで意味を確認**。
- **単語帳に保存**。
- **間隔復習**。
- **進捗を見る** — 時間、正答率、コンボ、カレンダー。

### デスクトップに馴染む

- **フローティング字幕** — 位置・サイズ・フォント・色・透明度。
- **フィードバック** — 基本キー音、Classic パーティクル、Combo。
- **トレイとホットキー**。
- **UI 言語**はアプリ設定、ドキュメント言語は上部リンク。

## エディション

Community は OSS ビルド。サイトの Free / Pro は商用版です。

| 機能 | Community（本リポ） | Free | Pro |
| --- | --- | --- | --- |
| 練習・復習 | ○ | ○ | ○ |
| 字幕・辞書・保存 | ○ | ○ | ○ |
| システム TTS / Piper | ○ | ○ | ○ |
| Classic 演出と基本キー音 | ○ | ○ | ○ |
| 追加スキン・キー音 | — | — | ○ |
| 基本 Excel | ○ | ○ | ○ |
| 例文 Excel / PDF | — | — | ○ |
| ライセンス解除 | — | Pro へ | 有効 |

詳細：[bubtype.com](https://bubtype.com)

## 開発

### 前提

- Windows x64（現在の主ターゲット）。
- Node.js `22.12+` と npm。
- Rust stable — [rust-toolchain.toml](rust-toolchain.toml)。
- MSVC / Windows SDK / WebView2。

### 起動

```powershell
npm ci
npm run tauri -- dev --config src-tauri/tauri.community.conf.json
```

フロントのみ：`npm run dev` → `http://localhost:1420`。

### ビルド

```powershell
npm run build
npm run tauri -- build --config src-tauri/tauri.community.conf.json
```

## 貢献

Issue / PR 歓迎。Community 向けの変更に留め、商用専用アセットやライセンス実装は入れないでください。

## ライセンス

[Apache License 2.0](./LICENSE)。サードパーティは各ライセンスに従います。
