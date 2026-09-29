<p align="center">
  <img src="public/logo.png" width="96" alt="BubType logo" />
</p>

<h1 align="center">BubType Community</h1>

<p align="center">
  <a href="./README.md">简体中文</a> ·
  <a href="./README.en.md">English</a> ·
  <a href="./README.zh-TW.md">繁體中文</a> ·
  <a href="./README.ja.md">日本語</a> ·
  <strong>Tiếng Việt</strong> ·
  <a href="./README.id.md">Bahasa Indonesia</a>
</p>

<p align="center"><strong>Mỗi lần gõ, nhớ thêm một chút tiếng Anh.</strong></p>

<p align="center">Luyện tiếng Anh trên desktop mã nguồn mở · phụ đề nổi · chính tả & ôn tập · âm phím và hiệu ứng</p>

<p align="center">
  <a href="#trai-nghiem">Trải nghiệm</a> ·
  <a href="#phien-ban">Phiên bản</a> ·
  <a href="#phat-trien">Phát triển</a> ·
  <a href="https://bubtype.com">Website</a> ·
  <a href="https://bubtype.com">BubType Pro</a> ·
  <a href="./LICENSE">Apache-2.0</a>
</p>

---

BubType ghép gõ bài, nghe viết, tra từ và ôn tập thành một vòng luyện. Chọn câu, nghe, gõ; chạm từ để tra và lưu. Phụ đề nổi giữ bài trên desktop.

Kho này là **BubType Community** (Apache-2.0). Xem toàn bộ sản phẩm tại [bubtype.com](https://bubtype.com).

## Trải nghiệm

### Bắt đầu từ một câu

- **Gõ / nghe viết / điền chỗ trống**.
- **Theo nhịp của bạn** — tốc độ, phát lại, bản dịch, IPA.
- **Dùng nội dung quen** — gói cảnh, sách từ, hàng đợi riêng.

### Từ tra cứu thành ôn tập

- **Chạm để tra** ngay trên phụ đề.
- **Sổ từ của bạn**.
- **Ôn cách quãng**.
- **Xem tiến độ**.

### Gắn với desktop

- **Phụ đề nổi** — vị trí, cỡ, font, màu, độ trong.
- **Phản hồi** — âm phím cơ bản, hạt Classic, combo.
- **Khay hệ thống & phím tắt**.
- **Ngôn ngữ giao diện** trong app; ngôn ngữ tài liệu ở thanh trên.

## Phiên bản

Community là bản OSS. Free / Pro trên website là bản thương mại.

| Tính năng | Community | Free | Pro |
| --- | --- | --- | --- |
| Luyện & ôn | Có | Có | Có |
| Phụ đề, tra từ, lưu | Có | Có | Có |
| TTS hệ thống / Piper | Có | Có | Có |
| Classic & âm cơ bản | Có | Có | Có |
| Gói giao diện & âm thêm | — | — | Có |
| Xuất Excel cơ bản | Có | Có | Có |
| Excel ví dụ & PDF | — | — | Có |
| Mở khóa giấy phép | — | Lên Pro | Đã mở |

Thông tin sản phẩm: [bubtype.com/about/](https://bubtype.com/about/)

## Phát triển

### Chuẩn bị

- Windows x64.
- Node.js `22.12+` và npm.
- Rust stable — [rust-toolchain.toml](rust-toolchain.toml).
- MSVC, Windows SDK, WebView2.

### Chạy

```powershell
npm ci
npm run tauri -- dev --config src-tauri/tauri.community.conf.json
```

Chỉ frontend: `npm run dev` → `http://localhost:1420`.

### Build

```powershell
npm run build
npm run tauri -- build --config src-tauri/tauri.community.conf.json
```

## Đóng góp

Issue / PR đều chào đón. Giữ thay đổi trong phạm vi Community.

## Giấy phép

[Apache License 2.0](./LICENSE). Thành phần bên thứ ba theo giấy phép riêng.
