<p align="center">
  <img src="public/logo.png" width="96" alt="BubType logo" />
</p>

<h1 align="center">BubType Community</h1>

<p align="center">
  <a href="./README.md">简体中文</a> ·
  <a href="./README.en.md">English</a> ·
  <strong>繁體中文</strong> ·
  <a href="./README.ja.md">日本語</a> ·
  <a href="./README.vi.md">Tiếng Việt</a> ·
  <a href="./README.id.md">Bahasa Indonesia</a>
</p>

<p align="center"><strong>讓每一次敲擊，都多記住一點英語。</strong></p>

<p align="center">開源桌面英語練習 · 懸浮字幕 · 聽寫與複習 · 鍵音與視覺回饋</p>

<p align="center">
  <a href="#產品體驗">產品體驗</a> ·
  <a href="#版本說明">版本說明</a> ·
  <a href="#本地開發">本地開發</a> ·
  <a href="https://bubtype.com">官網</a> ·
  <a href="https://bubtype.com">BubType Pro</a> ·
  <a href="./LICENSE">Apache-2.0</a>
</p>

---

BubType 把英語輸入、聽寫、查詞和複習放進一條連貫的練習流程。選擇一組句子，聽一遍，敲出來；遇到生詞就查詞、收藏，再透過複習鞏固。懸浮字幕讓練習留在桌面上。

本倉庫是 **BubType Community**（Apache-2.0 開源版）。完整產品線見 [bubtype.com](https://bubtype.com)。

## 產品體驗

### 從一句話開始

- **跟打、聽寫、填空**：在看著原句輸入、先聽後寫和補全句子之間切換。
- **照自己的節奏練習**：語速、重播、譯文、音標、自動下一句。
- **使用熟悉的內容**：場景句包、詞庫，或匯入自己的佇列。

### 把生詞變成下一次複習

- **點詞即查**，少切換視窗。
- **累積詞本**：單字、片語與句子。
- **間隔複習**，回到需要鞏固的內容。
- **看見進步**：時長、正確率、輸入量、連擊與日曆。

### 讓練習融入桌面

- **懸浮字幕**：位置、大小、字型、顏色、透明度與工具列。
- **即時回饋**：基礎鍵音、Classic 粒子與 Combo。
- **系統匣與快捷鍵**，方便呼出與控制。
- **介面語言**：在應用設定中切換；文件語言見頁頂連結。

## 版本說明

Community 為獨立開源建置；官網 Free / Pro 為商業發行版，細節以官網為準。

| 能力 | Community（本倉庫） | Free | Pro |
| --- | --- | --- | --- |
| 跟打、聽寫、填空與複習 | 支援 | 支援 | 支援 |
| 懸浮字幕、查詞與收藏 | 支援 | 支援 | 支援 |
| 系統語音 / 可選 Piper | 支援 | 支援 | 支援 |
| Classic 視覺與基礎鍵音 | 支援 | 支援 | 支援 |
| 更多視覺主題與鍵音 | — | — | 支援 |
| 基礎 Excel 匯出 | 支援 | 支援 | 支援 |
| Excel 例句與 PDF 匯出 | — | — | 支援 |
| 授權啟用 | 無 | 可升級為 Pro | 已啟用 |

了解更多：[bubtype.com/about/](https://bubtype.com/about/)

## 本地開發

### 環境準備

- Windows x64（目前主要目標）。
- Node.js `22.12+` 與 npm。
- Rust stable，見 [rust-toolchain.toml](rust-toolchain.toml)。
- MSVC、Windows SDK、WebView2 Runtime。

### 啟動

```powershell
npm ci
npm run tauri -- dev --config src-tauri/tauri.community.conf.json
```

僅前端：`npm run dev` → `http://localhost:1420`。瀏覽器無法完整模擬桌面能力。

### 檢查與打包

```powershell
npm run build
npm run tauri -- build --config src-tauri/tauri.community.conf.json
```

## 參與貢獻

歡迎 Issue / PR。請聚焦 Community 已公開能力，勿提交商業版專屬資源或授權相關實作。

## 授權

[Apache License 2.0](./LICENSE)。第三方程式碼、字型與音效遵循各自授權。
