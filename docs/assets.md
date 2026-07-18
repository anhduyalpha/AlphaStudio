# AlphaStudio asset system

AlphaStudio 3.4 uses the original **Studio Nodes** visual language: connected
points, precise rounded geometry, and a purple–blue–cyan signal gradient. The
system is designed to feel native to the existing interface while working on
light and dark surfaces without heavy bitmap payloads.

All public URLs are centralized in `src/assets/registry.js`. React code should
consume that registry or one of the shared components; do not scatter raw SVG
markup or hard-coded `/assets/...` strings across views.

## Brand assets

| Asset | View box / size | Intended use |
| --- | --- | --- |
| `public/assets/brand/alphastudio-mark.svg` | 64 × 64 | Default adaptive product mark |
| `alphastudio-mark-dark.svg` | 64 × 64 | Mark tuned for dark surfaces |
| `alphastudio-mark-light.svg` | 64 × 64 | Mark tuned for light surfaces |
| `alphastudio-wordmark.svg` | 310 × 64 | Compact wordmark on dark surfaces |
| `alphastudio-wordmark-light.svg` | 310 × 64 | Compact wordmark on light surfaces |
| `logo-horizontal.svg` | 360 × 76 | Full logo and descriptor on dark surfaces |
| `logo-horizontal-light.svg` | 360 × 76 | Full logo and descriptor on light surfaces |
| `logo-monochrome.svg` | 300 × 64 | Single-color print, mask, or inline SVG use |
| `favicon.svg` | 64 × 64 | Browser favicon |
| `app-icon.svg` | 512 × 512 | Vector app-icon master |
| `app-icon-192.png` | 192 × 192 | Web app / shortcut icon |
| `app-icon-512.png` | 512 × 512 | High-resolution web app icon |
| `app-icon-maskable.svg` | 512 × 512 | Maskable vector master with safe-zone geometry |
| `app-icon-maskable-512.png` | 512 × 512 | Maskable manifest icon |

`public/manifest.webmanifest` registers the PNG exports. The favicon and manifest
are linked in `index.html`. PNGs are deterministic renders of the SVG masters;
edit the master first, then regenerate with the existing Sharp dependency.

## Icon registry

`public/assets/icons/alphastudio-icons.svg` contains the shared symbols. Every
symbol uses `viewBox="0 0 24 24"`; stroke, size, and color are supplied by the
calling `<svg>` through `currentColor`.

Workspace symbols:

| Name | Meaning |
| --- | --- |
| `dashboard` | Dashboard |
| `converter` | All-in-One Converter |
| `image` | Image Lab |
| `pdf` | PDF Studio |
| `media` | Video and media tools |
| `audio` | Audio Lab |
| `archive` | Archive Center |
| `qr` | QR Lab |
| `text-ocr` | Text and OCR |
| `security` | Security Lab |
| `developer` | Developer Utilities |
| `color` | Color Studio |
| `activity` | Activity |
| `profile` | Profile Studio |
| `settings` | Settings |
| `tools-manager` | External tools manager |

Semantic status symbols:

| Name | Backend/UI state |
| --- | --- |
| `uploading` | Upload is in progress |
| `inspecting` | MIME/magic/deep inspection is active |
| `queued` | Job is persisted and waiting |
| `converting` | Worker is processing the job |
| `completed` | Validated output is available |
| `warning` | Non-fatal attention state |
| `failed` | Job or validation failed |
| `cancelled` | User/server cancelled the job |
| `unavailable` | Required capability is unavailable |

Utility symbols such as `download`, `trash`, `search`, and `layers` live in the
same sprite. Compatibility aliases (`swap` → `converter`, `play` → `media`, and
similar) are resolved in `src/components/Icon.jsx` so existing working features
remain intact while callers migrate.

### React usage and accessibility

```jsx
// Decorative: visible button text already supplies the accessible name.
<Icon name="converter" size={20} />

// Meaningful standalone icon: emits role="img" and an SVG title.
<Icon name="offline" size={24} label="Backend offline" />

// Maps real backend job status to a semantic symbol.
<StatusBadge status={job.status}>{job.status}</StatusBadge>
```

Icons are decorative by default (`aria-hidden="true"`). Pass `label` only when
the icon itself communicates information. Icon-only controls must put their
accessible name on the parent button or link. Never use an emoji as a substitute
for a product icon.

## Illustrations

Tool illustrations live under `public/assets/illustrations/tools/` at a 640 × 400
view box: `converter`, `pdf`, `qr`, `image`, `media`, `archive`, `text`, `audio`,
`color`, `security`, and `developer`. They have transparent outer canvases and
no embedded copy, allowing the surrounding card to control theme and layout.

Empty-state illustrations live under `public/assets/illustrations/empty/` at a
480 × 300 view box:

| Registry key | File | Scenario |
| --- | --- | --- |
| `upload` | `upload.svg` | No source file selected |
| `converted` | `converted.svg` | Converted Files has no outputs |
| `noResults` | `no-results.svg` | Search/filter/activity has no match |
| `toolsMissing` | `tools-missing.svg` | External capability is unavailable |
| `conversionFailed` | `conversion-failed.svg` | Real job failure |
| `offline` | `offline.svg` | Backend health request failed |

Use `<EmptyState type="converted" />`; do not duplicate illustration and copy
selection logic in a view. Images inside empty states are decorative because the
adjacent heading and description provide the accessible meaning.

## Patterns

- `public/assets/patterns/studio-grid.svg` — subtle Dashboard/application shell
  node grid.
- `public/assets/patterns/onboarding-orbit.svg` — onboarding and identity orbit
  surface, also included in the development gallery.

Patterns are pointer-transparent decoration and must never become the only way a
state is communicated.

## Development gallery

Run `npm run dev` and open `/#/assets`. The page checks:

- dark and light lockups;
- 16, 20, 24, 32, and 40 pixel icon rendering;
- hover and disabled control treatments;
- every workspace, status, and utility symbol;
- tool and empty-state illustration responsiveness;
- dashboard and onboarding patterns.

The route is created behind `import.meta.env.DEV` and loaded lazily. Production
builds neither expose the route nor emit its gallery chunk.

## Extension rules

1. Draw icons on the 24 × 24 grid with round caps/joins and `currentColor`.
2. Add the symbol to the sprite and its public name to `src/assets/registry.js`.
3. Keep decorative SVGs text-free, script-free, base64-free, and below 20 KB.
4. Give standalone SVG files a descriptive `<title>` and `<desc>`; use empty
   `alt` when the same meaning is already present as adjacent HTML text.
5. Specify intrinsic `width` and `height` in JSX to prevent layout shift.
6. Check both themes and the 640 px responsive layout in the asset gallery.
7. Run `npm test`, which includes the structural asset regression suite.

All artwork in this directory was created specifically for AlphaStudio. It does
not reuse third-party logos, copyrighted illustrations, icon fonts, or emoji.
