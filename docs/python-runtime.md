# Python runtime integration (Phases 1-5)

AlphaStudio can invoke an optional Python runtime for specialized processing
without changing the Node/Fastify architecture. Python is **not** a server and
**not** a daemon: it is a short-lived CLI child process spawned per job by the
existing worker, using the same `execFileTracked` path as FFmpeg, LibreOffice,
Pandoc, and Calibre. Node keeps ownership of scheduling, leases, heartbeat,
cancellation, output validation, and recovery.

Phase 1 shipped the foundation and one deterministic, dependency-free operation:
`data.json-transform` (JSON to CSV/TSV). Phase 2 adds tabular and document
operations. Heavier profiles (data, documents, vision, ocr, ai) are never
installed by default.

## Operations and profiles

| Operation | Routes | Profile | Modules |
| --- | --- | --- | --- |
| `data.json-transform` | json -> csv, json -> tsv | core | (stdlib) |
| `data.table-transform` | csv/tsv -> json | core | (stdlib) |
| `data.table-transform` | xlsx <-> json | data | pandas, openpyxl |
| `data.table-transform` | parquet <-> csv/json | data | pandas, pyarrow |
| `document.to-pdf` | md -> pdf, html -> pdf | documents | weasyprint (+ markdown) |

Routes another engine already owns are intentionally not advertised by Python:
`csv<->tsv` (built-in), `csv<->xlsx/ods` (LibreOffice). The `document.to-pdf`
routes use priority 8 so WeasyPrint is preferred over the built-in pdf-lib text
route (priority 10) only when the documents profile is installed; otherwise the
built-in route still handles md/html -> pdf. The Node engine gates every
profile route on `bridge.py --selfcheck`, which reports importable modules.

### Specialized operations (`pyop` job type)

Operations that are not format conversions (same-format or multi-artifact) run
through a dedicated `pyop` job type instead of the converter route table:

| Operation | Input -> Output | Profile | Modules |
| --- | --- | --- | --- |
| `pdf.ocr-searchable` | pdf -> searchable pdf | ocr | ocrmypdf (+ Tesseract/Ghostscript) |
| `image.deskew` | image -> same format | vision | opencv, numpy |
| `image.autocrop` | image -> same format | vision | opencv, numpy |
| `pdf.extract-tables` | pdf -> csv (zipped if many) | documents | camelot-py |
| `media.transcribe` | audio/video -> txt/srt/vtt | ai | faster-whisper (+ model) |
| `image.background-removal` | image -> transparent png | vision | rembg (+ u2net model) |
| `doc.summarize` | text -> summary / answer txt | ai | llama-cpp-python (+ GGUF model) |

`POST /api/jobs { type: "pyop", uploadIds, options: { operation, ... } }`.
Availability is gated in `assertJobCapable` via `pythonOperationStatus` (same
selfcheck), and each op is listed in `/api/capabilities` with an install hint
when its profile is absent. A single artifact is returned directly; multiple
artifacts are zipped (same pattern as the batch converter).

### Model management

AI/vision model weights are never downloaded during a job. They are installed
explicitly into `.runtime/python/models/` (shared across platforms, git-ignored):

```
npm run python:models -- --list                 # show models + local presence
npm run python:models -- --model whisper-base    # faster-whisper weights (ai profile)
npm run python:models -- --model u2net           # rembg weights (verified when a sha256 is set)
```

`python/models.lock.json` is the registry. File-engine models refuse to install
without a configured `sha256` unless `--allow-unverified` is passed; Whisper
weights are fetched and integrity-checked by faster-whisper/Hugging Face into the
models dir. `media.transcribe` and `image.background-removal` fail with an
actionable hint when the model is missing (never auto-downloading).

The optional summarizer (`doc.summarize`) is not auto-downloaded either: place a
`.gguf` model in `.runtime/python/models/llm/` (large, license-varied weights).
With a custom `options.prompt` it also answers questions about the document.

## Design

```
POST /api/jobs (type: converter, options.format: csv)
  -> worker -> processConverter -> routeConversion -> convertOne
       -> engineId === 'python' -> convertWithPython()
            -> execFileTracked(python, [bridge.py, --operation ...])   # one-shot, no shell
                 -> python/bridge.py -> operations/json_transform.py
```

* The Python engine is a normal `ConversionEngineAdapter`
  ([server/src/convert/engines/python.ts](../server/src/convert/engines/python.ts)),
  registered alongside the other engines in
  [engines/index.ts](../server/src/convert/engines/index.ts). It advertises
  `json -> csv` and `json -> tsv` routes tagged with `metadata.operation`.
* `json` is a first-class format: registered in
  [formats.ts](../server/src/convert/formats.ts) and detected from `.json`
  in [detect.ts](../server/src/convert/detect.ts) so the conversion matrix can
  route it.
* The bridge is stdlib-only and self-registers operations via the
  `@register_operation("id")` decorator in
  [python/operations/__init__.py](../python/operations/__init__.py).

## Runtime management

The interpreter lives in a project-local virtualenv (never global, no admin):

```
.runtime/python/<platform>-<arch>/venv/{bin|Scripts}/python
```

`.runtime/` is git-ignored. A fingerprint (SHA-256 of the profile requirements
plus interpreter version) is stored in `.runtime/python/fingerprint.json` so
repeat installs are skipped when nothing changed.

```
npm run python:install     # create venv + install the core profile (stdlib only)
npm run python:check        # report venv health, version, and fingerprint match
npm run python:repair       # delete and recreate the venv
```

Install a heavier profile explicitly (Phase 2+):
`node scripts/maint/python.mjs install --profile data`. Profiles:
`core, data, documents, vision, ocr, ai`. Requirements live in
`python/requirements-<profile>.txt`. `npm run bootstrap` / `runtime:prepare`
never touch Python.

Discovery order at runtime: the managed venv first, then `python3` / `python`
on `PATH`. A Python below 3.10 is reported unavailable with an actionable
reason; when Python is absent the routes simply report unavailable and every
existing conversion is unaffected.

## Bridge protocol (v1)

Invocation (no shell, arguments only):

```
python bridge.py --operation data.json-transform \
  --input <path> [--input <path> ...] --input-name <name> \
  --output-dir <dir> --options <json> --limits <json>
```

* **Progress** — `ALPHA_PROGRESS:<0-100>:<message>` lines on stderr.
* **Success** — exit code 0 and a single-line JSON result on stdout:
  `{"protocol":1,"outputs":[{"name","mime","path"}],"meta":{...}}`.
* **Error** — non-zero exit and a human-readable message on stderr
  (Node truncates to 500 chars and wraps it as an engine failure).
* **Cancellation** — Node kills the process tree (`taskkill /T /F` on Windows,
  `SIGKILL` to the group on POSIX). The bridge also handles `SIGTERM` for
  cooperative cleanup.
* **Path confinement** — every output must resolve inside `--output-dir`. The
  bridge enforces this and the worker re-checks via `ensureOutputInside`.

## Resource safety

Phase 1 reuses the existing safety envelope and adds Python-specific limits:

| Safeguard | Where |
| --- | --- |
| Upload / output size | `config.maxUploadBytes`, `config.maxOutputBytes` (bridge also enforces `maxOutputBytes`) |
| Timeout | `config.pythonTimeoutMs` (default 300000) passed to `execFileTracked` |
| Memory | `config.pythonMaxMemoryMb` (default 1024); best-effort `RLIMIT_AS` on POSIX |
| Process-tree kill | `child-registry` `killProcessTree` |
| No network | bridge makes no network calls; runs with a restricted proxy environment |
| No shell | `execFileTracked(python, args)` — never `shell: true` |

## Adding an operation

1. Create `python/operations/<name>.py` and decorate the handler:

   ```python
   from . import register_operation, OperationContext, OperationResult, OperationArtifact

   @register_operation("data.my-op")
   def my_op(ctx: OperationContext) -> OperationResult:
       ...
       return OperationResult(outputs=[OperationArtifact(name, mime, path)], meta={})
   ```

2. Import it from `python/operations/__init__.py` (`_load_builtin_operations`).
3. Advertise the route(s) in `pythonEngine.discoverCapabilities` with
   `metadata.operation = "data.my-op"`, and add any new input/output formats to
   `formats.ts` (and `detect.ts` if a new extension must be detected).

## Tests

* `npm run test:python` — bridge protocol + operations (json/table transforms,
  selfcheck, profile gating) via the venv or system interpreter.
* `npm test` — includes
  [server/tests/python-engine.test.ts](../server/tests/python-engine.test.ts):
  runtime resolution, adapter probe/discovery, capability gating, registry
  routes, `.json` detection, cancellation, and full `processConverter`
  JSON->CSV and CSV->JSON pipelines. Integration cases skip automatically when
  no Python 3.10+ is present; profile routes skip when their modules are absent.

## Roadmap

All five phases are implemented: foundation + data, document, OCR, vision,
transcription/subtitles, background removal, and the optional local-LLM
summarizer, each behind its opt-in profile with on-demand model management.
Every heavy profile and model stays opt-in; the core profile is stdlib-only and
absence of Python leaves all existing conversions unchanged.
