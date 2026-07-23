<phase>
Phase 5 — Image, Media, Audio, and QR workspaces
</phase>

<context_from_previous_phase>
Read state, blueprint, decisions, Phase 4 handoff, backend capability contracts, and both skills.
</context_from_previous_phase>

<image_requirements>
- real image canvas or preview is the focal area;
- source/output dimensions, format, quality, and metadata impact are visible;
- contextual before/after comparison where real;
- advanced controls use progressive disclosure;
- batch states remain clear.
</image_requirements>

<media_requirements>
- player and timeline-oriented composition;
- contextual trim, transcode, and extract-audio controls;
- real duration, codecs, container, and metadata only;
- no fabricated live preview or progress.
</media_requirements>

<audio_requirements>
Verify backend truth first.

Expected operations must be confirmed, including possible:

- convert;
- trim;
- normalize;
- inspect.

Create a real audio workspace with:

- player;
- waveform where safely generated from the local file;
- timeline;
- editable trim range;
- supported output-format controls;
- supported bitrate/sample rate/channel controls;
- normalization target;
- visual metadata inspector.

Do not present vocal separation or unsupported AI behavior as operational.
</audio_requirements>

<qr_requirements>
- separate Generate and Decode modes;
- QR preview/result is the focal object;
- clipboard and paste workflows remain accessible;
- validation and errors are clear.
</qr_requirements>

<liquid_effects>
Use liquid feedback where meaningful:

- dropzone activation;
- timeline selection;
- scrub/trim handles;
- QR generation completion;
- image comparison transitions.

Do not apply continuous distortion to previews or text.
</liquid_effects>

<tasks>
Implement route by route, running a build after each route. Create green checkpoint commits if needed. Capture before/after screenshots and create `docs/ux-ui-redesign/PHASE_5_HANDOFF.md`.
</tasks>

<validation>
```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
git diff --check
```
</validation>

<commit>
```text
[ux-ui-redesign:phase-5] redesign image media audio and QR workspaces
```

Push before stopping.
</commit>
