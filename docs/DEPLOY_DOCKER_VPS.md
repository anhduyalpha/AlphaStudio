# Docker and VPS deployment (full runtime)

Personal self-host path for AlphaStudio with the Converter full runtime.

## Docker

```bash
docker build -f deploy/Dockerfile.full-runtime -t alphastudio:full .
docker run --rm -p 8787:8787 \
  -e API_AUTH_TOKEN=replace-me \
  -v alphastudio-data:/app/data \
  alphastudio:full
```

Open `http://127.0.0.1:8787`.

Notes:

- Build runs `tools:install` once; **container start never downloads tools**.
- Mount only `data/` for persistence (SQLite, uploads, outputs).
- `.runtime/tools` is baked into the image; rebuild to update tools.
- Expect multi-GB image size (LibreOffice + FFmpeg + Calibre + Pandoc).

## VPS (Linux)

1. Install Node 20+ and OS packages from `docs/BUILD_AND_RUN_WINDOWS_LINUX.md`.
2. Clone repo, `npm run bootstrap`, copy `.env.example` → `.env`.
3. Set `HOST=0.0.0.0`, strong `API_AUTH_TOKEN` / `VITE_API_TOKEN`, then `npm run build && npm start`.
4. Put TLS and rate limiting on a reverse proxy (Caddy/nginx); AlphaStudio does not terminate HTTPS.
5. Resource defaults for small VPS:

```dotenv
WORKER_POOL_SIZE=1
OFFICE_WORKER_CONCURRENCY=1
MEDIA_WORKER_CONCURRENCY=1
```

6. Verify: `npm run runtime:verify` (or `npm run tools:check -- --force`).

## Safety

- Conversion workers never invoke `tools:install` / network tool downloads.
- OCR/PDF extras remain capability-gated when binaries are missing.
