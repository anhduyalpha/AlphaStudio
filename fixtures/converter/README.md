# Converter fixtures

Tiny samples for family routing tests and manual smoke. Prefer these over large binaries in unit tests.

## Present (checked in)

| File | Family | Notes |
| --- | --- | --- |
| `sample.txt` | text | plain UTF-8 |
| `sample.md` | text | markdown |
| `sample.html` | text | minimal HTML |
| `sample.csv` | spreadsheet | two columns |
| `sample.tsv` | spreadsheet | tab separated |
| `sample.json` | text/data | small object |
| `sample.png` | image | 1×1 PNG |
| `sample.jpg` | image | 1×1 JPEG |

## Required later (generate or license-ok copy; not all must be committed)

| Sample | Family | How |
| --- | --- | --- |
| wav / mp3 | audio | `ffmpeg -f lavfi -i sine=d=0.2 sample.wav` |
| mp4 | video | lavfi color source via ffmpeg |
| docx / xlsx / pptx | office | LibreOffice or committed tiny OOXML |
| pdf | pdf | `fixtures/pdf/text-basic.pdf` (shared) |
| epub | ebook | calibre ebook-convert from txt (local only) |
| zip / 7z | archive | 7z a |

PDF tools already share `fixtures/pdf/*`. Reuse those for PDF→image/text tests.

## Rules

- No DRM samples.  
- No copyrighted media.  
- Capability-gated tests must skip cleanly when optional engines are missing.  
- Never download fixtures during a conversion job.
