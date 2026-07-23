# AlphaStudio

Local-first utility suite built with **React + Vite**, **Fastify + SQLite**, background workers, resumable uploads, PDF tools, converters, and optional Python processing.

## Requirements

- Node.js **20+**
- About **3 GB** free disk space for the full converter runtime
- Python **3.10+** only for optional Python/AI features

## Install

Clone the repository:

```bash
git clone https://github.com/anhduyalpha/AlphaStudio.git
cd AlphaStudio
```

### Full installation

```bash
npm run bootstrap
```

Installs Node dependencies plus **7-Zip, FFmpeg/ffprobe, LibreOffice, Pandoc, and Calibre**.

### App only

```bash
npm ci --no-audit --no-fund
```

Use this when you only need to run the app. Missing external tools will appear as unavailable but will not prevent startup.

Create the environment file:

```powershell
# Windows
Copy-Item .env.example .env
```

```bash
# Linux/macOS
cp .env.example .env
```

## Run

Development:

```bash
npm run dev
```

Open `http://localhost:5173`.

Production:

```bash
npm run build
npm start
```

Open `http://127.0.0.1:8787`.

`dev`, `build`, and `start` do not install external tools automatically. Install or repair them separately with:

```bash
npm run runtime:prepare
```

## Optional Python features

Install only the profiles you need:

```bash
node scripts/maint/python.mjs install --profile core
node scripts/maint/python.mjs install --profile data
node scripts/maint/python.mjs install --profile documents
node scripts/maint/python.mjs install --profile vision
node scripts/maint/python.mjs install --profile ocr
node scripts/maint/python.mjs install --profile ai
```

Optional AI models:

```bash
npm run python:models -- --list
npm run python:models -- --model whisper-base
npm run python:models -- --model u2net --allow-unverified
```

## Check installation

```bash
npm run doctor
npm run tools:check
npm run test:python
```

More details: [`docs/BUILD_AND_RUN_WINDOWS_LINUX.md`](docs/BUILD_AND_RUN_WINDOWS_LINUX.md) · [`docs/python-runtime.md`](docs/python-runtime.md)
