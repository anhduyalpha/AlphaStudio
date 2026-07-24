# Build và chạy AlphaStudio trên Windows/Linux

Tài liệu này áp dụng cho AlphaStudio 3.6.0. Cấu hình mặc định chạy local tại
`http://127.0.0.1:8787`; Fastify phục vụ cả frontend production và API trên cùng
một origin.

## 1. Yêu cầu

- Node.js 20 trở lên và npm đi kèm. Node 20 hoặc Node 24 LTS được khuyến nghị.
- Khoảng 3 GiB trống cho source, toàn bộ npm dependency, build và full runtime
  Converter Phase 1.
- Windows: PowerShell 7 hoặc Windows PowerShell.
- Linux x64: `tar`, `unzip`, `xz-utils`, `python3`, `xdg-utils`, EGL/OpenGL và
  XCB cursor runtime cho các bộ cài portable/isolated.

Không chạy `npm install` riêng trong `server/`. Repo dùng npm workspaces và một
`package-lock.json` ở thư mục gốc.

## 2. Full runtime được cài mặc định

Quy trình chuẩn không còn yêu cầu người dùng tự chọn profile. `npm run
bootstrap`, `dev`, `build` và `start` đều gọi bước chuẩn bị runtime đầy đủ.
`tools:check`, `tools:install`, `tools:repair` và `tools:update` trong
`package.json` luôn gắn `--profile full`.

| Profile | Công cụ | Định dạng/chức năng chính | Download / cài đặt ước tính |
|---|---|---|---|
| Node core | Sharp, pdf-lib | Ảnh hiện có, PDF native, text, ZIP/TAR/GZ | Nằm trong `npm ci`; không thêm external runtime |
| `core` | 7-Zip | 7Z, XZ, BZ2 và archive fallback | ~3 / ~8 MiB |
| `media` | FFmpeg + ffprobe | MP3/WAV/FLAC/AAC/M4A/OGG/Opus/WMA và MP4/WebM/MKV/MOV/AVI/MPEG/WMV/M4V/FLV/GIF theo capability thực tế | ~125 / ~180 MiB |
| `documents` | LibreOffice + Pandoc | Office; Markdown/HTML/TXT/RST/AsciiDoc; DOCX/RTF | ~385 / ~1.690 MiB |
| `ebooks` | Calibre `ebook-convert` | EPUB, MOBI, AZW3, FB2, HTMLZ và target text/document đã kiểm chứng | package native ~205 / ~430 MiB |
| Feature tùy chọn | Tesseract + PDF rasterizer | OCR/PDF-to-image | Phụ thuộc OS/package |

`full` là hợp của `core + media + documents + ebooks`, tương đương khoảng
718 MiB download và 2,3 GiB sau cài đặt. Đây là lựa chọn mặc định bắt buộc của
các npm script công khai. ImageMagick, Tesseract và PDF extras không bị kéo vào
`full` vì chúng không phải engine Converter Phase 1.

ImageMagick và các engine ảnh/vector chuyên dụng không thuộc Phase 1; ảnh core
vẫn dùng Sharp. PDF input không bao giờ được chuyển qua LibreOffice.

Text/Markdown→PDF dùng font Unicode hệ thống (Arial/Segoe UI trên Windows,
DejaVu/Liberation/Noto trên Linux). Có thể chỉ định font TTF/OTF bằng
`PDF_FONT_PATH`.

Thứ tự ưu tiên là tool hệ thống, sau đó mới tới tool portable của dự án tại:

```text
.runtime/tools/<platform>-<arch>/
```

Tool hệ thống hợp lệ vẫn được ưu tiên để tránh tải lại. Nếu thiếu, installer tải
toàn bộ phần còn thiếu vào runtime của project. Lệnh chuẩn:

```text
npm run tools:install
npm run tools:check -- --force
npm run tools:repair
npm run tools:update
npm run runtime:verify
npm run doctor
```

`npm run runtime:verify` gộp tools check (profile full) và python check (core).
Không tải tool. Python data/documents: `npm run python:install -- --profile data`
hoặc `--profile documents`. Docker/VPS: xem `docs/DEPLOY_DOCKER_VPS.md`.

`tools.mjs` in download và installed-size estimate trước khi thao tác. FFmpeg,
7-Zip, Pandoc, LibreOffice và Calibre đều được xử lý trong cùng một lượt.
Calibre dùng bộ phân phối chính thức: MSI administrative extraction trên
Windows, isolated binary trên Linux và DMG trên macOS.

Installer tự xóa archive và cây giải nén trung gian sau khi binary cuối đã được
kiểm tra. Chỉ đặt `ALPHA_KEEP_TOOL_DOWNLOADS=1` khi cần debug installer.

## 3. Cài và build trên Windows

Mở PowerShell tại thư mục project:

```powershell
node --version
npm --version
npm run bootstrap
Copy-Item .env.example .env

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
sudo apt update
sudo apt install -y tar unzip xz-utils python3 xdg-utils \
  libegl1 libopengl0 libxcb-cursor0 libxcb-xinerama0
npm run bootstrap
cp .env.example .env

npm run build
npm start
```

Mở `http://127.0.0.1:8787`.

Trên Linux x64, installer tải LibreOffice AppImage rồi giải nén vào runtime và
dùng Calibre isolated binary chính thức, không cần ghi vào `/usr` hoặc `/opt`.
Calibre yêu cầu GLIBC 2.34, libstdc++ từ GCC 11.4 trở lên và các XCB/EGL
runtime nêu ở bước prerequisite.

Linux ARM64 hiện vẫn cần FFmpeg và LibreOffice từ package manager vì portable
FFmpeg/LibreOffice của project chỉ được xác minh trên x64. Sau khi cài native,
chạy lại `npm run tools:install`; Pandoc, 7-Zip và Calibre ARM64 vẫn được xử lý
trong lượt full install.

WSL dùng tool Linux trong distribution, không dùng binary Windows trong
`.runtime/tools/win32-*`. Với Docker, mount source/data riêng và chạy `npm run
bootstrap` trong image. Full runtime làm image tăng khoảng 2,3 GiB; cần cấp đủ
disk cho layer chứa `.runtime/tools`.

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

`npm run tools:check` kiểm tra full external capability và trả exit code khác
0 nếu thiếu bất kỳ tool Phase 1 nào. Capability gating ở runtime vẫn giữ nguyên
để không quảng cáo sai format khi binary hỏng hoặc bị xóa sau lúc build.

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

Không xóa riêng Pandoc/LibreOffice/Calibre nếu còn dùng quy trình chuẩn:
`dev`, `build` hoặc `start` sẽ phát hiện thiếu và tải lại full runtime.

Sau khi build/test xong, có thể thu nhỏ dependency production:

```text
npm prune --omit=dev
```

Sau đó muốn build/test lại phải chạy `npm run bootstrap`.

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
  `npm run tools:repair`, sau đó gọi
  `POST /api/convert/matrix/refresh`. Registry cũng tự hết hạn cache; không cần
  restart backend trong trường hợp an toàn này.
- Native package lỗi sau khi đổi Node/OS: xóa `node_modules` có chủ đích rồi
  chạy lại `npm run bootstrap`; không cài riêng trong `server/`.
- Database/schema lỗi: dùng `npm run db:repair`; lệnh này sửa schema mà không
  chủ động xóa workspace.
- LibreOffice portable lỗi trên Linux x64: cài các package
  writer/calc/impress của distro rồi chạy lại `npm run tools:repair`.
- Pandoc/Calibre download lỗi: kiểm tra HTTPS/proxy và dung lượng trống rồi chạy
  lại `npm run tools:install`. Ebook có DRM trả lỗi unsupported; AlphaStudio
  không gỡ hoặc tuyên bố hỗ trợ DRM.
- OCR hoặc PDF-to-image unavailable: cài Tesseract và một rasterizer như
  `pdftoppm`, sau đó bật feature và chạy lại tool check.

## 11. Phạm vi đã xác minh

Ngày 19/07/2026, full-install flow của Phase 1 được build và kiểm thử trên
Windows x64, Node 24.
Regression, maintenance, audit, build, tool check và doctor phải được chạy lại
theo mục 6 cho mỗi release; kết quả cụ thể nằm trong handoff/CI của commit.

Linux container test xác minh source/build/runtime portable ở mức có thể của
image; capability cụ thể vẫn phụ thuộc package/codec/filter của distribution.
Luôn chạy `npm run tools:check -- --force` trên máy Linux đích trước khi quảng
cáo một format.
