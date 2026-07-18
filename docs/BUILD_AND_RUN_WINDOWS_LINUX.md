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

AlphaStudio chạy được ngay với dependency Node trong `npm ci`. External tool
được chia thành profile độc lập; không cần cài FFmpeg, LibreOffice, Pandoc hay
Calibre nếu không dùng nhóm định dạng tương ứng.

| Profile | Công cụ | Định dạng/chức năng chính | Download / cài đặt ước tính |
|---|---|---|---|
| Node core | Sharp, pdf-lib | Ảnh hiện có, PDF native, text, ZIP/TAR/GZ | Nằm trong `npm ci`; không thêm external runtime |
| `core` | 7-Zip | 7Z, XZ, BZ2 và archive fallback | ~3 / ~8 MiB |
| `media` | FFmpeg + ffprobe | MP3/WAV/FLAC/AAC/M4A/OGG/Opus/WMA và MP4/WebM/MKV/MOV/AVI/MPEG/WMV/M4V/FLV/GIF theo capability thực tế | ~125 / ~180 MiB |
| `documents` | LibreOffice + Pandoc | Office; Markdown/HTML/TXT/RST/AsciiDoc; DOCX/RTF | ~385 / ~1.690 MiB |
| `ebooks` | Calibre `ebook-convert` | EPUB, MOBI, AZW3, FB2, HTMLZ và target text/document đã kiểm chứng | package native ~205 / ~430 MiB |
| Feature tùy chọn | Tesseract + PDF rasterizer | OCR/PDF-to-image | Phụ thuộc OS/package |

ImageMagick và các engine ảnh/vector chuyên dụng không thuộc Phase 1; ảnh core
vẫn dùng Sharp. PDF input không bao giờ được chuyển qua LibreOffice.

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

Các profile dùng cùng một cú pháp cho `check`, `install`, `repair` và `update`:

```text
# Chỉ kiểm tra/cài/sửa/cập nhật đúng nhóm cần dùng
npm run tools:check -- --profile core
npm run tools:install -- --profile media
npm run tools:repair -- --profile documents
npm run tools:update -- --profile ebooks

# Chọn tool riêng; có thể lặp lại --tool/--profile
npm run tools:check -- --tool pandoc
npm run tools:install -- --profile media --tool 7z

# Không có selector: giữ hành vi tương thích ngược của AlphaStudio 3.6
npm run tools:install
npm run tools:check -- --force
npm run doctor
```

`tools.mjs` in download và installed-size estimate trước khi thao tác. Profile
`documents` chỉ tải Pandoc/LibreOffice khi được chọn. Profile `ebooks` không
bundle Calibre: nó nhận một native/system install đã có và in lệnh cài theo OS
nếu thiếu. Cách này tránh thêm khoảng 430 MiB vào install mặc định.

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
# npm run tools:install -- --profile media

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
# npm run tools:install -- --profile media

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

Pandoc và Calibre trên Debian/Ubuntu:

```bash
sudo apt install pandoc calibre
npm run tools:repair -- --profile documents --profile ebooks
```

Portable FFmpeg hiện chỉ bảo đảm cho Linux x64. Trên Linux ARM64, nên cài
FFmpeg từ package manager của hệ điều hành; không dùng URL portable x64.

WSL dùng tool Linux trong distribution, không dùng binary Windows trong
`.runtime/tools/win32-*`. Với Docker, mount source/data riêng và cài profile
trong image; ví dụ base Debian cần `ffmpeg`, `p7zip-full`, và tùy nhu cầu
`libreoffice`, `pandoc`, `calibre`. Calibre/LibreOffice làm image tăng đáng kể,
vì vậy nên build image theo workload thay vì một image chứa mọi profile.

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

Registry probe đọc demuxer/muxer/decoder/encoder của FFmpeg và format list của
Pandoc/Calibre trên chính máy đang chạy. UI chỉ quảng cáo giao của capability
đã probe với allowlist an toàn của AlphaStudio, không tạo ma trận N×M.

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
DOCX→PDF, PPTX→PNG, Pandoc và ebook conversion vào đúng hàng đợi Office.
FFmpeg mặc định có tối đa 2 conversion cùng lúc; Calibre và LibreOffice nên
được tính khoảng 0,5–1,0 GiB RAM cho mỗi process nặng tùy tài liệu. Với máy
4–8 GiB, giữ pool/category ở `1`.

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

Nếu không dùng markup/Office, có thể xóa riêng Pandoc/LibreOffice sau khi dừng
server. Chỉ profile/tool được chọn mới cài lại optional runtime đó.

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
- Vừa cài tool nhưng UI vẫn báo unavailable: chạy
  `npm run tools:repair -- --profile <profile>`, sau đó gọi
  `POST /api/convert/matrix/refresh`. Registry cũng tự hết hạn cache; không cần
  restart backend trong trường hợp an toàn này.
- Native package lỗi sau khi đổi Node/OS: xóa `node_modules` có chủ đích rồi
  chạy lại `npm ci`; không cài riêng trong `server/`.
- Database/schema lỗi: dùng `npm run db:repair`; lệnh này sửa schema mà không
  chủ động xóa workspace.
- Thiếu LibreOffice trên Linux: cài các package writer/calc/impress của distro.
- Thiếu Pandoc/Calibre: cài native package rồi chạy `tools:repair` cho profile
  `documents`/`ebooks`. Ebook có DRM trả lỗi unsupported; AlphaStudio không
  gỡ hoặc tuyên bố hỗ trợ DRM.
- OCR hoặc PDF-to-image unavailable: cài Tesseract và một rasterizer như
  `pdftoppm`, sau đó bật feature và chạy lại tool check.

## 11. Phạm vi đã xác minh

Ngày 18/07/2026, Phase 1 được build và kiểm thử trên Windows x64, Node 24.
Regression, maintenance, audit, build, tool check và doctor phải được chạy lại
theo mục 6 cho mỗi release; kết quả cụ thể nằm trong handoff/CI của commit.

Linux container test xác minh source/build/runtime portable ở mức có thể của
image; capability cụ thể vẫn phụ thuộc package/codec/filter của distribution.
Luôn chạy `tools:check -- --profile ... --force` trên máy Linux đích trước khi
quảng cáo một format.
