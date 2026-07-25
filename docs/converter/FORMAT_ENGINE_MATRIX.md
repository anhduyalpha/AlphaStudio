# Format ↔ Engine Matrix (frozen baseline)

**Branch:** `ux-ui-redesign`  
**Freeze date:** 2026-07-24  
**Source of truth:** live adapters under `server/src/convert/engines/` + policy in each adapter.  
**Rule:** advertised pairs = policy allowlist ∩ probed engine capability. Never N×M cross-product.

Status legend:

| Status | Meaning |
| --- | --- |
| keep | Shipped and policy-approved |
| capability | Available only when probe/selfcheck succeeds |
| lossy | Intentional quality loss (re-encode / text extract) |
| experimental | Fixture-tested but quality variable |
| unsupported | Explicitly denied or not advertised |

## Engines

| Engine id | Profile | Handler | Notes |
| --- | --- | --- | --- |
| `alphastudio` | core | builtin | Sharp + pdf-lib + pure JS |
| `ffmpeg` | media | media | Dynamic demux/mux/codec probe |
| `pandoc` | documents | pandoc | Requires sandbox support |
| `libreoffice` | documents | libreoffice | Concurrency 1; never PDF input |
| `calibre` | ebooks | calibre | DRM fail-closed |
| `pdf-rasterizer` | core* | pdf | Poppler / mutool / Ghostscript optional |
| `sevenzip` | core | archive | 7z / xz / bz2 |
| `python` | python-* | python | Routes gated on bridge selfcheck |

\* PDF rasterizer is registered as profile `core` but binaries are optional PATH probes.

## Documents

| Source | Targets | Engine (priority order) | Status |
| --- | --- | --- | --- |
| doc | pdf, docx, odt, txt, html, rtf | libreoffice | keep |
| docx | pdf, odt, txt, html, rtf, doc | libreoffice | keep |
| odt | pdf, docx, txt, html, rtf | libreoffice | keep |
| rtf | pdf, docx, odt, txt, html | libreoffice | keep |
| txt / md / html | pdf | builtin pdf-lib; python WeasyPrint (p8 when installed) | keep / capability |
| txt / md / html / rst / asciidoc | each other, docx, rtf (Pandoc SAFE_PAIRS) | pandoc | keep / capability |
| md / html | docx | libreoffice | keep |
| pdf | docx | — | **unsupported** (never LO PDF-in) |
| pdf | txt | builtin extract | keep / lossy |

## Spreadsheets / data

| Source | Targets | Engine | Status |
| --- | --- | --- | --- |
| xls | xlsx, ods, csv, pdf | libreoffice | keep |
| xlsx | ods, csv, pdf, xls | libreoffice | keep |
| ods | xlsx, csv, pdf | libreoffice | keep |
| csv | xlsx, ods, pdf | libreoffice | keep |
| csv ↔ tsv, txt | — | builtin | keep |
| json → csv/tsv | — | python core | keep |
| csv/tsv → json | — | python core | keep |
| xlsx ↔ json | — | python data (pandas/openpyxl) | capability |
| parquet ↔ csv/json | — | python data (pyarrow) | capability |

## Presentations

| Source | Targets | Engine | Status |
| --- | --- | --- | --- |
| ppt | pdf, pptx, odp, png, jpeg | libreoffice | keep |
| pptx | pdf, odp, png, jpeg, ppt | libreoffice | keep |
| odp | pdf, pptx, png, jpeg | libreoffice | keep |
| ppt* → video | — | — | **unsupported** |

## Images (Sharp policy)

| Source | Targets | Engine | Status |
| --- | --- | --- | --- |
| png | jpeg, webp, avif, gif, tiff, bmp, pdf, ico | alphastudio | keep / capability (avif) |
| jpeg | png, webp, avif, gif, tiff, bmp, pdf, ico | alphastudio | keep / capability |
| webp | png, jpeg, avif, gif, tiff, bmp, pdf | alphastudio | keep |
| avif / heic / heif | subset → png/jpeg/webp/pdf | alphastudio | capability |
| gif | png, jpeg, webp, pdf; mp4/webm via ffmpeg | alphastudio + ffmpeg | keep |
| tiff / bmp / ico / svg | see IMAGE_POLICY in `builtin.ts` | alphastudio | keep / capability |
| ImageMagick advanced | optional future profile `images` | — | not Phase C0 |

## Audio / video (FFmpeg SAFE_PAIRS ∩ probe)

Audio inputs: mp3, wav, flac, aac, m4a, ogg, opus, wma → common audio outs.  
Video inputs: mp4, mkv, webm, mov, avi, mpeg, wmv, m4v, flv → video outs + audio extract + gif where listed.  
gif → mp4, webm.  
All pairs **capability**-gated on demuxer/decoder/muxer/encoder. Re-encodes are **lossy**.

## Archives

| Source | Targets | Engine | Status |
| --- | --- | --- | --- |
| zip ↔ tar / gz | — | builtin | keep |
| tar ↔ zip / gz | — | builtin | keep |
| gz / tgz ↔ zip / tar | — | builtin | keep |
| 7z / xz / bz2 → zip/tar/7z | — | sevenzip | capability |
| RAR create | — | — | **unsupported** |
| RAR extract | 7z if present | sevenzip | experimental / not advertised until verified |

## eBooks (Calibre verified subset)

| Source | Targets | Engine | Status |
| --- | --- | --- | --- |
| epub, mobi, azw3, fb2 | epub, mobi, azw3, fb2, txt, pdf, rtf, htmlz (≠ same) | calibre p15 | capability |
| txt → epub/mobi/azw3/fb2 | — | calibre p30 | capability |
| epub → pdf/txt/html | libreoffice fallback p80 | libreoffice | keep / capability |
| DRM-protected | — | — | fail closed / unsupported |

## PDF-related

| Source | Targets | Engine | Status |
| --- | --- | --- | --- |
| pdf → png, jpeg | pdf-rasterizer (pdftoppm → mutool → gs) | capability |
| pdf → txt | builtin | keep / lossy |
| pdf → searchable (OCR) | pyop ocrmypdf | capability / converter-adjacent |
| pdf repair/compress advanced | qpdf/gs (PDF tools) | out of Converter primary |

## Text / web / data (safe)

| Route | Engine | Status |
| --- | --- | --- |
| json/csv/tsv transforms | python core | keep |
| html/md/txt/rst/asciidoc via Pandoc | pandoc | keep / capability |
| Network fetch / scraping | — | **unsupported** |

## Explicit denials

1. PDF input never routed through LibreOffice.  
2. Same-format Office conversions are no-ops (rejected).  
3. No shell-invoked engines; argv arrays only.  
4. No tool install/download during conversion jobs.  
5. No ConvertX matrices or AGPL source copies.

## Priority cheat sheet

| Class | Preferred | Fallback |
| --- | --- | --- |
| Images | alphastudio (Sharp) | optional ImageMagick (future) |
| Office | libreoffice | — |
| Markup | pandoc | builtin text |
| MD/HTML → PDF | python WeasyPrint (p8) | builtin pdf-lib (p10) |
| eBooks | calibre | libreoffice limited |
| Media | ffmpeg | — |
| Archives | builtin then sevenzip | — |
| PDF → image | poppler → mutool → gs | — |

## Maintenance

When adapters change SAFE_PAIRS or probe policy, update this document in the same PR and bump `.converter-complete-state.json` `matrixRevision`.
