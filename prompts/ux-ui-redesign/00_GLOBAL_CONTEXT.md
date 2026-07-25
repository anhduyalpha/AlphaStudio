<repository>
URL:

```text
https://github.com/anhduyalpha/AlphaStudio
```

Base branch:

```text
origin/main
```

Required working branch:

```text
ux-ui-redesign
```

Final Pull Request:

```text
base: main
head: ux-ui-redesign
```
</repository>

<product_context>
AlphaStudio is a local-first utility suite with:

- React 18 and Vite frontend;
- Node.js 20+ TypeScript/Fastify backend;
- SQLite persistence;
- background process workers;
- resumable uploads;
- SSE/WebSocket/polling progress;
- cancellation, retry, recovery, and output validation;
- capability-driven external tools;
- PDF, converter, image, media, archive, QR, developer, security, text/OCR, audio, color, activity, profile, and settings routes;
- optional Python operations and models.

The redesign must preserve these behaviors and must not rewrite backend architecture merely to obtain a new visual result.
</product_context>

<route_inventory>
Production routes include:

```text
dashboard
converter
pdf
qr
image
media
archive
text
audio
color
security
developer
activity
profile
settings
```

The agent must verify this list against the current repository before implementation.
</route_inventory>

<primary_goal>
Create a complete product-level UX/UI redesign.

This is not a reskin. The work must materially change:

- information architecture;
- navigation organization;
- layout composition;
- content hierarchy;
- component structure;
- placement of input, settings, preview, progress, and results;
- empty, loading, running, completed, failed, cancelled, offline, and unavailable states;
- responsive behavior;
- interaction feedback;
- animation system;
- route-specific workflow design.

Every user-facing element and shared component must be audited and either:

1. redesigned;
2. replaced;
3. reorganized;
4. removed;
5. or explicitly justified as already optimal.
</primary_goal>

<visual_direction>
Required direction:

```text
Premium Minimalism
+ purposeful UX
+ subtle Liquid / Water interactions
+ restrained Glass surfaces
+ original desktop utility identity
```

Minimalism must mean:

- fewer unnecessary containers;
- strong hierarchy;
- clearer primary actions;
- disciplined spacing;
- contextual controls;
- progressive disclosure;
- useful whitespace;
- reduced decoration;
- high information clarity.

Minimalism must not mean:

- changing everything to black and white;
- keeping the same DOM and applying new colors;
- wrapping old layouts in rounded cards;
- copying a generic SaaS dashboard;
- removing all personality.
</visual_direction>

<color_direction>
Use a restrained neutral base with selective accent colors and semantic state colors.

Do not flatten the entire application into monochrome. Color must communicate:

- selected state;
- tool family;
- success, warning, failure, progress, and unavailable states;
- focus and interaction;
- visual depth where useful.
</color_direction>

<liquid_effect_direction>
Water/liquid effects must be subtle, purposeful, performant, and accessible.

Possible uses:

- press and hover ripples;
- drag-and-drop surface response;
- liquid focus transitions;
- gentle refraction inside elevated glass surfaces;
- wave-like progress feedback;
- fluid panel transitions;
- completion micro-interactions;
- cursor-proximity response on selected high-value surfaces.

Do not:

- apply continuous water distortion to the whole page;
- distort readable text;
- use full-screen WebGL only for decoration;
- create motion sickness;
- block input or reduce performance;
- animate every element;
- use water effects as a substitute for good hierarchy.

Prefer progressive enhancement and GPU-friendly implementation. Provide static or simplified fallbacks for:

- `prefers-reduced-motion`;
- coarse pointers;
- low-power devices;
- unsupported filter APIs.
</liquid_effect_direction>

<non_negotiable_product_safety>
Preserve:

- current route behavior;
- upload and resumable-upload flows;
- job creation and persistence;
- progress updates;
- cancellation and retry;
- workspace hydration;
- capability detection;
- converter engine routing;
- PDF operation contracts;
- secure output downloads;
- Windows and Linux support;
- current backend API contracts.

Never:

- modify `main` directly;
- create a different working branch;
- create a Git worktree or duplicate repository folder;
- force-push;
- rewrite published history;
- merge automatically;
- fabricate backend capability;
- render fake controls as operational;
- fake progress;
- weaken tests to make a phase pass;
- silently discard unrelated user files.
</non_negotiable_product_safety>
