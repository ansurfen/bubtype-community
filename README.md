<p align="center">
  <img src="public/logo.png" width="96" alt="BubType logo" />
</p>

<h1 align="center">BubType Community</h1>

<p align="center"><strong>让每一次敲击，都多记住一点英语。</strong></p>

<p align="center">开源桌面英语练习 · 悬浮字幕 · 听写与复习 · 键盘声与视觉反馈</p>

<p align="center">
  <a href="#产品体验">产品体验</a> ·
  <a href="#版本说明">版本说明</a> ·
  <a href="#本地开发">本地开发</a> ·
  <a href="https://bubtype.com">官网</a> ·
  <a href="https://bubtype.com/buy/">BubType Pro</a> ·
  <a href="./LICENSE">Apache-2.0</a>
</p>

---

BubType 把英语输入、听写、查词和复习放进一条连贯的练习流程。选择一组句子，听一遍，敲出来；遇到生词就查词、收藏，再通过复习巩固。悬浮字幕让练习留在桌面上，键盘声、粒子与连击反馈为每次输入增加一点乐趣。

本仓库是 **BubType Community**（Apache-2.0 开源版），可自行构建与分发。付费增强能力见 [BubType Pro](https://bubtype.com/buy/)。

## 产品体验

### 从一句话开始

- **跟打、听写、填空**：在看着原句输入、先听后写和补全句子的练习之间切换。
- **按自己的节奏练习**：调整语速、重播语音，选择是否显示翻译提示、音标及自动进入下一句。
- **使用熟悉的内容**：从场景句包、已安装词库开始，也可以导入自己的文本练习队列。

### 把生词变成下一次复习

- **点词即查**：在字幕中查看词义，减少练习过程中的切换。
- **积累自己的词本**：收藏单词、短语和句子，回看查词记录。
- **持续复习**：通过学习进度与间隔复习安排，回到需要巩固的内容。
- **看见进步**：查看学习时长、正确率、输入量、连击和学习日历。

### 让练习融入桌面

- **悬浮字幕**：调整位置、大小、字体、颜色与透明度，搭配可配置工具栏使用。
- **即时反馈**：基础键盘声、Classic 粒子效果与连击反馈。
- **桌面操作**：系统托盘与全局快捷键，方便呼出和控制练习。
- **界面语言**：应用内支持英语、简体中文、繁体中文、日语、越南语、印尼语（随版本扩展，以应用设置为准）。

## 版本说明

Community 是独立开源构建；官网安装的 Free / Pro 为商业发行版，由许可证决定是否解锁更多视觉、键音与导出。

| 能力 | Community（本仓库） | Free | Pro |
| --- | --- | --- | --- |
| 跟打、听写、填空与复习 | 支持 | 支持 | 支持 |
| 悬浮字幕、查词与收藏 | 支持 | 支持 | 支持 |
| 系统语音 / 可选 Piper 本地语音 | 支持 | 支持 | 支持 |
| Classic 视觉效果与基础键盘声 | 支持 | 支持 | 支持 |
| 更多视觉主题与键盘音色 | — | — | 支持 |
| 基础 Excel 导出 | 支持 | 支持 | 支持 |
| Excel 例句与 PDF 导出 | — | — | 支持 |
| 许可证激活 | 无 | 可升级为 Pro | 已激活 |

了解 Pro：[bubtype.com](https://bubtype.com) · [购买](https://bubtype.com/buy/)

## 本地开发

### 环境准备

- Windows x64（当前主要开发与构建目标）。
- Node.js `22.12+` 与 npm（Vite 亦支持 Node.js `20.19+` 的 20.x）。
- Rust stable，见 [rust-toolchain.toml](rust-toolchain.toml)。
- Windows 桌面构建所需的 MSVC C++ 工具、Windows SDK 与 WebView2 Runtime。

### 启动

```powershell
npm ci
npm run tauri -- dev --config src-tauri/tauri.community.conf.json
```

只看前端时可 `npm run dev`，然后打开 `http://localhost:1420`。浏览器预览无法覆盖托盘、全局快捷键、桌面语音等原生能力。

### 检查与打包

```powershell
npm run build
npm run tauri -- build --config src-tauri/tauri.community.conf.json
```

## 参与贡献

欢迎 Issue 与 Pull Request。请聚焦 Community 已公开的能力与体验；不要向本仓库提交商业版专属资源或许可证相关实现。

## 许可证

[Apache License 2.0](./LICENSE)

第三方代码、字体和音效遵循各自许可证。音效来源说明见 [src/assets/sfx/NOTICE.md](src/assets/sfx/NOTICE.md)。
