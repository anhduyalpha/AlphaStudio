# Build và chạy AlphaStudio trên Windows/Linux

Tài liệu này áp dụng cho AlphaStudio 3.6.0. Cấu hình mặc định chạy local tại
`http://127.0.0.1:8787`; Fastify phục vụ cả frontend production và API trên cùng
một origin.

## 1. Yêu cầu

- Node.js 20 trở lên và npm đi kèm. Node 20 hoặc Node 24 LTS được khuyến nghị.
- Khoảng 500 MiB trống cho source, dependency và build core.
- Windows: PowerShell 7 hoặc Windows PowerShell.
- Linux: `tar` và `unzip` nếu dùng bộ cài tool portable.

Không chạy `npm install` riêng trong `server/`. Repo dùng npm workspaces và một
`package-lock.json` ở thư mục gốc.

## 2. Chọn profile công cụ

AlphaStudio chạy được ngay ở profile core. Không cần cài toàn bộ FFmpeg,
LibreOffice hay 7-Zip nếu không dùng các nhóm định dạng tương ứng.

| Công cụ | Khi nào cần | Cài đặt khuyến nghị |
|---|---|---|
| Sharp | Image Lab và chuyển đổi ảnh | Đã nằm trong `npm ci` |
| pdf-lib | PDF merge/split/rotate/reorder và PDF từ ảnh | Đã nằm trong `npm ci` |
| FFmpeg + ffprobe | Audio/video, trim, transcode, inspect | Cài hệ thống hoặc `npm run setup:tools -- --only ffmpeg` |
| LibreOffice | DOC/DOCX, XLS/XLSX, PPT/PPTX và Office conversion | Cài hệ thống hoặc `npm run setup:tools -- --only libreoffice` |
| 7-Zip | 7Z, XZ, BZ2 | Cài hệ thống hoặc `npm run setup:tools -- --only 7z` |
| Pandoc | Chưa được runtime 3.6 gọi; dành cho tích hợp tương lai | Không cần cài mặc định |
| ImageMagick | Tùy chọn; ảnh core đã dùng Sharp | Không cần cài |
| Tesseract + PDF rasterizer | OCR/PDF-to-image tùy chọn | Cài hệ thống và bật feature tương ứng |

Text/Markdown→PDF dùng font Unicode hệ thống (Arial/Segoe UI trên Windows,
DejaVu/Liberation/Noto trên Linux). Có thể chỉ định font TTF/OTF bằng
`PDF_FONT_PATH`.

Thứ tự ưu tiên là tool hệ thống, sau đó mới tới tool portable của dự án tại:

```text
.runtime/tools/<platform>-<arch>/
```

Tool hệ thống tiết kiệm ổ đĩa khi nhiều ứng dụng cùng dùng một FFmpeg hoặc
LibreOffice. Tool portable dễ mang theo nhưng LibreOffice có thể chiếm khoảng
1,5 GiB sau giải nén trên Windows.

Các profile:

```text
# Core nhẹ nhất: bỏ qua bước cài tool

# Chỉ cài đúng nhóm đang dùng
npm run setup:tools -- --only ffmpeg
npm run setup:tools -- --only libreoffice
npm run setup:tools -- --only 7z
# Chỉ tích hợp tương lai: npm run setup:tools -- --only pandoc

# Full capability theo runtime hiện tại (không tự tải Pandoc/ImageMagick)
npm run tools:install
npm run tools:check -- --force
npm run doctor
```

Installer tự xóa archive và cây giải nén trung gian sau khi binary cuối đã được
kiểm tra. Chỉ đặt `ALPHA_KEEP_TOOL_DOWNLOADS=1` khi cần debug installer.

## 3. Cài và build trên Windows

Mở PowerShell tại thư mục project:

```powershell
node --version
npm --version
npm ci
Copy-Item .env.example .env

# Tùy chọn: cài đúng external tool cần dùng
# npm run setup:tools -- --only ffmpeg

npm run build
npm start
```

Mở `http://127.0.0.1:8787`.

Nếu PowerShell báo port 8787 đang bận, dừng process cũ hoặc đổi `PORT` trong
`.env`. Windows Firewall chỉ cần rule inbound khi chủ động mở cho máy khác trong
LAN.

## 4. Cài và build trên Linux

Tại thư mục project:

```bash
node --version
npm --version
npm ci
cp .env.example .env

# Tùy chọn, ví dụ chỉ cần media:
# npm run setup:tools -- --only ffmpeg

npm run build
npm start
```

Mở `http://127.0.0.1:8787`.

LibreOffice không được auto-download trên Linux. Cài bằng package manager của
distro, ví dụ Debian/Ubuntu:

```bash
sudo apt update
sudo apt install libreoffice-writer libreoffice-calc libreoffice-impress
npm run tools:check -- --force
```

Portable FFmpeg hiện chỉ bảo đảm cho Linux x64. Trên Linux ARM64, nên cài
FFmpeg từ package manager của hệ điều hành; không dùng URL portable x64.

## 5. Chạy development

```text
npm run dev
```

- Frontend Vite: `http://localhost:5173`
- Backend Fastify: `http://127.0.0.1:8787`
- Vite proxy `/api` sang backend.

Muốn chạy riêng:

```text
npm run dev:client
npm run dev:server
```

## 6. Kiểm tra trước khi chạy production

```text
npm run build
npm test
npm run test:maint
npm run test:audit
npm run deps:check
npm audit
npm run audit:backend
```

Đọc `audit/backend-audit.json`, không chỉ dựa vào exit code của audit. Hai
benchmark nặng hơn, chạy khi cần đo release:

Main server suite chạy tuần tự theo file để các integration test dùng process
worker/SQLite/port không tranh chấp tài nguyên và để peak RAM ổn định.

```text
npm run benchmark:workers
npm run benchmark:upload
```

`npm run tools:check` kiểm tra full external capability. Core app vẫn có thể
chạy khi một external tool không có; UI sẽ đánh dấu nhóm liên quan là
`Unavailable`.

## 7. Cấu hình máy ít RAM/ít dung lượng

Mặc định nên để các biến worker trong `.env` ở trạng thái comment để pool tự
cân theo CPU và RAM còn trống. Với máy 4–8 GiB hoặc workload LibreOffice/FFmpeg
nặng, đặt:

```dotenv
WORKER_POOL_SIZE=1
IMAGE_WORKER_CONCURRENCY=1
PDF_WORKER_CONCURRENCY=1
MEDIA_WORKER_CONCURRENCY=1
OFFICE_WORKER_CONCURRENCY=1
GENERAL_WORKER_CONCURRENCY=1
```

`OFFICE_WORKER_CONCURRENCY=1` nên được giữ ngay cả trên máy mạnh. Scheduler xếp
DOCX→PDF, PPTX→PNG và EPUB fallback vào đúng hàng đợi Office.

Giới hạn chống archive bomb:

```dotenv
MAX_ARCHIVE_ENTRIES=10000
MAX_EXTRACTED_BYTES=209715200
```

Giảm `MAX_EXTRACTED_BYTES` nếu ổ đĩa nhỏ. Giá trị này giới hạn tổng dung lượng
giải nén trước khi job có thể làm đầy `data/temp`.

Dọn staging/cache cũ nhưng giữ workspace và tool đã cài:

```text
npm run clear -- --dry-run --keep-workspaces
npm run clear -- --keep-workspaces
npm run build
```

Lệnh `clear` cũng xóa `dist` và `server/dist`, vì vậy phải build lại. Không dùng
`clear --all` cho bảo trì thường kỳ vì nó xóa cả `data` và `.runtime`.

Nếu một bản AlphaStudio cũ đã tải Pandoc nhưng không dùng tích hợp tương lai,
dừng server rồi có thể xóa riêng thư mục
`.runtime/tools/<platform>-<arch>/pandoc/`. Installer mới không tự tải Pandoc;
chỉ `--only pandoc` hoặc `ALPHA_REQUIRE_PANDOC=1` mới cài lại.

Sau khi build/test xong, có thể thu nhỏ dependency production:

```text
npm prune --omit=dev
```

Sau đó muốn build/test lại phải chạy `npm ci`.

## 8. Dữ liệu, backup và retention

- SQLite: `data/alphastudio.db`
- Upload: `data/uploads`
- Output: `data/outputs`
- Temp: `data/temp`
- Tool portable: `.runtime/tools`

Dừng server sạch trước khi backup để SQLite checkpoint WAL. Backup tối thiểu
`.env` và toàn bộ `data/`; `.runtime` có thể cài lại.

Các biến retention chính:

```dotenv
TEMP_TTL_MS=3600000
WORKSPACE_RETENTION_MS=604800000
```

Không chạy cleanup khi job hoặc upload đang hoạt động.

## 9. Chạy trong LAN

Chỉ dùng trong LAN tin cậy. Cấu hình trước khi build frontend:

```dotenv
HOST=0.0.0.0
CORS_ORIGIN=http://192.168.1.20:8787
API_AUTH_TOKEN=replace-with-a-long-random-token
VITE_API_TOKEN=replace-with-the-same-token
```

Sau đó:

```text
npm run build
npm start
```

`VITE_API_TOKEN` được nhúng lúc build nên đổi token phải build lại. Token trong
bundle frontend không phù hợp để bảo vệ một deployment public Internet.
AlphaStudio không tự cung cấp HTTPS hay app-level rate limiting; nếu public hóa,
cần reverse proxy, TLS, authentication và rate limiting ở lớp ngoài.

## 10. Xử lý lỗi thường gặp

```text
npm run doctor
npm run tools:check -- --force
npm run deps:check
npm run db:repair
```

- Production chỉ hiện metadata API: kiểm tra `dist/index.html`,
  `SERVE_FRONTEND=1` và chạy lại `npm run build`.
- Vừa cài tool nhưng UI vẫn báo unavailable: restart backend vì capability được
  cache theo process.
- Native package lỗi sau khi đổi Node/OS: xóa `node_modules` có chủ đích rồi
  chạy lại `npm ci`; không cài riêng trong `server/`.
- Database/schema lỗi: dùng `npm run db:repair`; lệnh này sửa schema mà không
  chủ động xóa workspace.
- Thiếu LibreOffice trên Linux: cài các package writer/calc/impress của distro.
- OCR hoặc PDF-to-image unavailable: cài Tesseract và một rasterizer như
  `pdftoppm`, sau đó bật feature và chạy lại tool check.

## 11. Phạm vi đã xác minh

Ngày 18/07/2026, project đã được build và kiểm thử thực tế trên Windows x64,
Node 24:

- 407/407 regression tests đạt khi full toolchain có mặt.
- 24/24 maintenance tests và 4/4 audit-harness tests đạt.
- Backend audit: 0 issue, 21 conversion rows.
- Production UI/API cùng origin, upload README.md, MD→PDF, QR generation, JSON
  Formatter, theme, navigation desktop và viewport mobile đều hoạt động.

Linux commands và source path đã được rà soát, nhưng không thể khẳng định đã
chạy runtime Linux từ máy Windows này. Nên chạy lại matrix ở mục 6 trên máy
Linux đích trước release.
