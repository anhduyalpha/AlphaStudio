# Converter Phase 1 — Engine Registry, Media, Documents and Ebooks

## Branch

`feature/converter-phase-1-engine-registry`

Base branch: `feature/next-development`.

## Goal

Build a capability-driven converter architecture for AlphaStudio, then use it to
expand the high-value media, document, markup and ebook formats without losing
the current automatic file detection, grouped conversion UI, worker isolation,
output validation or selective tool installation.

The UI must advertise only conversions that the binaries installed on the
current machine can actually perform. A static list copied from ConvertX is not
an acceptable capability source.

## Current architecture to preserve

- React 18 and Vite client.
- Fastify and TypeScript server.
- Magic/metadata-based file inspection in the server.
- Conversion graph and recommendations in
  `server/src/convert/matrix.ts`.
- Converter dispatch in `server/src/processors/converter.ts`.
- Tool discovery in `server/src/tools`.
- Persistent jobs, worker pool, cancellation, timeouts and category limits.
- Output validation before results are exposed.
- Grouped UI and common-target intersection in
  `src/lib/converterGroups.js`.
- Selective tool management through `scripts/maint/tools.mjs`.

## Scope

### 1. Engine registry contract

Introduce a server-side registry whose adapters expose a common contract:

- Stable engine ID and reader-facing name.
- Supported operating systems and executable candidates.
- `probe()` for executable path and version.
- `discoverCapabilities()` for actual readable/writable formats.
- Normalized input/output aliases, MIME types and families.
- Route priority, fallback order and conversion cost.
- Required companion tools.
- Worker category and concurrency limit.
- Command builder or native conversion handler.
- Output validator.
- Installation profile and approximate installed size when known.

Registry results must be cached with explicit invalidation after tool
installation, repair or update. Probe failures must not make file inspection or
the Converter page fail.

### 2. Capability graph

Replace the static graph as the sole source of truth with:

```text
safe built-in pairs
    + capabilities reported by installed engines
    + AlphaStudio policy allow/deny rules
    = advertised conversion graph
```

Requirements:

- Preserve `jpg`/`jpeg` and other canonical alias normalization.
- Continue to gate every output with availability and a human-readable reason.
- Do not expose arbitrary N×M pairs merely because an engine recognizes both
  extensions.
- Allow multiple engines for a pair with a deterministic priority and fallback.
- Keep explicit denials for unsafe, meaningless or unsupported pairs.
- Include selected engine metadata in detection and job results.
- Keep recommendations stable and family-aware.

### 3. Dynamic FFmpeg capabilities

- Parse the installed FFmpeg/ffprobe build instead of relying only on the
  current hand-maintained media list.
- Distinguish demuxers, muxers, decoders and encoders.
- Advertise a pair only when a valid decode and encode/mux path exists.
- Maintain a policy map for common containers and default codecs.
- Keep stream-copy optimization where compatible.
- Preserve metadata/strip-metadata and quality presets.
- Treat image sequences and device/input-only formats as denied by default.
- Add bounded probe time, output-size guardrails and actionable errors.

### 4. Pandoc adapter

- Discover input/output formats using Pandoc's own list commands.
- Support useful text/markup pairs such as Markdown, HTML, plain text, RST,
  AsciiDoc where the installed build supports them.
- Use isolated temporary directories.
- Sanitize arguments and never invoke a shell.
- Disable network access, filters, Lua scripts and unsafe resource loading by
  default.
- Do not claim PDF output unless a tested PDF engine is available.
- Prefer existing native AlphaStudio text/PDF paths for pairs where they are
  safer or lighter.

### 5. LibreOffice adapter migration

- Wrap the existing LibreOffice behavior in the engine registry.
- Preserve isolated user profiles and concurrency `1`.
- Retain the existing office allowlist rather than assuming all filters are
  safe.
- Detect failed conversions where LibreOffice exits successfully but produces
  no valid output.
- Ensure PDF input is never routed through LibreOffice.

### 6. Calibre ebook adapter

- Probe `ebook-convert` independently from LibreOffice.
- Add ebook detection and a conservative pair allowlist derived from installed
  capabilities and verified fixtures.
- Start with EPUB, MOBI, AZW3, FB2 and supported text/document targets.
- Avoid DRM claims; DRM-protected files must return a clear unsupported error.
- Apply timeout, file-count, extraction and output-size limits.
- Prefer Calibre over LibreOffice for ebook-to-ebook conversions.

### 7. Selective installation profiles

Extend tool management with independently installable profiles:

- `core`: existing native dependencies and archive support.
- `media`: FFmpeg and ffprobe.
- `documents`: LibreOffice and Pandoc.
- `ebooks`: Calibre.

Requirements:

- `check`, `install`, `repair` and `update` accept a profile/tool selection.
- Existing commands without a profile remain backward compatible.
- Display download and installed-size estimates when metadata is available.
- Reuse cached downloads and avoid duplicate binaries.
- Do not bundle Calibre, LibreOffice or Pandoc into the default Node install.
- Document native Windows and Linux installation plus optional Docker/WSL use.

### 8. API and UI integration

- Keep the current automatic grouping by detected format.
- Show the selected/preferred engine for each group.
- Show why a format is unavailable and which optional profile provides it.
- Refresh capabilities after tools are installed without restarting when safe.
- Do not expose raw executable paths or command lines to the browser.
- Preserve mixed-group common-output behavior.

## Out of scope

- Image/vector specialist engines: ImageMagick, GraphicsMagick, Vips,
  Inkscape, resvg, libheif and libjxl. These belong to Phase 2.
- 3D conversion through Assimp.
- TeX Live, dvisvgm, Potrace and VTracer.
- Copying ConvertX source code or its static matrices.
- Guaranteeing identical capabilities on every operating system.
- Installing every optional dependency by default.

## Suggested implementation order

1. Add registry types, normalization and an in-memory capability snapshot.
2. Adapt current built-in, FFmpeg and LibreOffice paths without changing
   behavior.
3. Generate the advertised graph from registry capabilities plus policy.
4. Add route priority, fallback and engine metadata.
5. Add dynamic FFmpeg discovery and policy tests.
6. Add Pandoc adapter and fixtures.
7. Add Calibre adapter and fixtures.
8. Add installation profiles and cache invalidation.
9. Update Converter UI engine/unavailable states.
10. Update Windows/Linux documentation and run the full validation suite.

Each step should remain reviewable. Avoid combining registry refactoring,
multiple new engines and UI redesign in one commit.

## Expected code areas

- `server/src/tools/registry.ts` and related optional-binary helpers.
- New `server/src/convert/engines/` adapters.
- `server/src/convert/matrix.ts`.
- `server/src/processors/converter.ts`.
- Media, office and ebook processor modules.
- Detect/inspect DTOs and capability API responses.
- `scripts/maint/tools.mjs` and its tests.
- `src/lib/converterGroups.js`.
- `src/views/ConverterView.jsx`.
- `docs/BUILD_AND_RUN_WINDOWS_LINUX.md`.

Inspect exact callers and tests before changing any public type or response
shape.

## Testing requirements

### Unit tests

- Format and MIME alias normalization.
- Capability union, policy filtering, priority and fallback.
- Cache TTL and invalidation.
- Parser fixtures for multiple FFmpeg/Pandoc versions.
- Missing, timed-out and malformed executable output.
- No N×M over-advertising.
- Stable recommendations and mixed-group intersections.

### Adapter integration tests

- FFmpeg audio, video and audio-extraction happy paths.
- Unsupported codec/container combinations.
- Pandoc safe text/markup conversions.
- LibreOffice office conversions and false-success handling.
- Calibre ebook conversions and invalid/DRM-like input errors.
- Cancellation, timeout and output validation for every external engine.

Tests that require optional binaries must be capability-gated, but parsers and
routing logic must always run in CI using fixtures or fake executables.

### Regression and build

Run:

```bash
npm test
npm run test:maint
npm run test:hygiene
npm run build
npm run tools:check
npm run doctor
```

Also test manually on at least one supported Windows environment and one Linux
environment or Linux container.

## Resource and security requirements

- Never execute through a shell or concatenate user input into command strings.
- Use argument arrays, isolated temporary directories and normalized paths.
- Bound probe duration, conversion duration, output size and child processes.
- Preserve worker-category limits; LibreOffice remains single-concurrency.
- Do not allow network fetching by conversion engines.
- Do not log file contents, secrets or full user paths.
- Clean all intermediates on success, failure and cancellation.
- A missing optional engine must degrade gracefully.

## Definition of done

- Existing converter behavior and tests remain green.
- Capabilities shown by the API/UI reflect the current machine.
- FFmpeg, Pandoc, LibreOffice and Calibre use the common registry.
- At least one tested fallback route exists where two engines support a pair.
- Tool profiles install/check/repair independently.
- The default install remains lightweight.
- Windows and Linux build/run documentation is updated.
- Full test and build commands pass with results recorded in the final handoff.
- No ConvertX AGPL source or matrices are copied into the repository.

## Copy-paste prompt for a new Codex task

```text
Work on Converter Phase 1 in AlphaStudio.

Repository: C:\Users\Duy\Code\Project\AlphaStudio
Branch: feature/converter-phase-1-engine-registry
Plan: docs/CONVERTER_PHASE_1_PLAN.md

Read the entire plan and inspect the existing converter, tool registry, worker,
tests and installation scripts before editing. Implement the plan end to end in
small reviewable commits. Preserve AlphaStudio's magic/metadata detection,
automatic grouping UI, capability gating, worker isolation and output
validation. Do not copy ConvertX source or static format matrices. Dynamically
probe installed tools, apply an explicit safe conversion policy, and keep
optional tools selectively installable to control disk and memory usage.

Run all tests and builds listed in the plan. Do not start Phase 2 image/vector
work on this branch. Report implemented formats, platform limitations, resource
impact, test results and remaining risks.
```
