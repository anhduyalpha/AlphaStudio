# Unit E3 — PdfOrganizerPanel

## Objective

Replace the unresolved `pdf-organizer` registry entry with a bounded, accessible page
organizer for the server-published `reorder`, `rotate`, `extract`, `delete-pages`, and
`duplicate-pages` operations. The panel edits state through `dispatch`; it does not call
the API, submit jobs, or own workspace state.

## Data flow and ownership

1. `usePdfWorkbench` remains the workspace and network owner.
2. In Organize mode, the controller filters the live PDF operation contract to the five
   editor-supported operations and gates each option with the corresponding capability.
3. The selected operation drives file cardinality, validation, request construction, and
   the panel presentation. Switching operations resets stale page/angle/edit-plan state.
4. The controller fetches the selected server file through the authenticated API client.
   It passes a browser `File` plus explicit preview status/error/retry state to the panel.
5. `PdfOrganizerPanel` loads and renders that `File` with the shared bounded PDF.js helper.
   It emits only serializable editor actions:
   - `set-operation`
   - `set-pages`
   - `set-angle`
   - `set-plan`
   - `retry-preview`
6. The normal workbench Run action remains the only job submission path.

## Panel state contract

The controller passes:

- `file`: selected workspace-file metadata, or `null`
- `previewFile`: authenticated browser `File`, or `null`
- `previewStatus`: `idle | loading | ready | error | limited`
- `previewError`: reader-facing recovery detail
- `operations`: capability-gated editor choices
- `operation`, `pages`, `angle`, `editPlan`
- `disabled`: true while a PDF job is active

The panel treats `pages` as authoritative. Thumbnail selection or reorder publishes the
same 1-based page syntax accepted by the server and a matching `editPlan` containing the
known `pageCount`.

## Bounded preview lifecycle

- Refuse controller downloads above `PDF_PREVIEW_BYTE_LIMIT`.
- Refuse thumbnail rendering above `PDF_PREVIEW_PAGE_LIMIT`.
- Render only `PDF_PREVIEW_WINDOW_SIZE` pages at a time.
- Run at most `PDF_PREVIEW_RENDER_CONCURRENCY` render tasks.
- Cancel render tasks and destroy PDF.js loading/document tasks on file, operation, window,
  or unmount invalidation.
- Use the bundled same-origin PDF.js worker and never encode the full PDF as base64.

## Correctness invariants

- Server operation descriptors and capability gates remain execution authority.
- Unknown or unpublished operations cannot be selected or submitted.
- Delete-pages cannot publish every page as a deletion plan.
- Reorder preserves all pages exactly once unless the user manually enters a plan, which
  remains subject to existing client and server validation.
- A failed or limited preview never blocks the manual page field or backend execution.
- The panel imports no API, protocol, store, or workspace modules.
- All controls are keyboard reachable, labeled, and use shared UI primitives and tokens.

## Implementation sequence

1. Add an authenticated, abortable file-blob reader to `src/api/client.js`.
2. Extend `usePdfWorkbench` with organizer operation state, preview fetch lifecycle,
   capability-gated choices, retry, and panel dispatch handling.
3. Implement `PdfOrganizerPanel.jsx` with explicit empty/loading/error/limited/ready states,
   operation and angle controls, bounded thumbnails, selection, paging, drag/keyboard
   reorder, and plan publication.
4. Add token-based responsive styles to `workbench.css`.
5. Add client tests for pure organizer helpers, registry resolution, state rendering,
   dispatch behavior, and source-layer enforcement.

## Verification

- Focused organizer/client tests.
- Full client tests, typecheck, production build, visual checks/diff, and `git diff --check`.
- Browser verification against the running frontend/backend:
  - select a PDF and observe thumbnails;
  - reorder pages and run;
  - select pages for rotate/extract/delete/duplicate and run at least one selection flow;
  - exercise preview retry/error or bounded-state presentation;
  - confirm result persistence, no horizontal overflow on desktop/mobile, and no fresh
    console warnings/errors.

## Risks and mitigations

- **Stale async preview:** generation guards plus AbortController and PDF.js task cleanup.
- **Operation drift:** derive choices from the live server contract and reset form state on
  operation changes.
- **Large documents:** enforce byte/page/window/concurrency limits before expensive work.
- **Accidental destructive plan:** disable “use selection” for an all-page delete and rely on
  existing client/server validation as a second line of defense.
- **Dense UI:** keep the page tools within the Configure card, use compact shared controls,
  and stack action rows at narrow widths.
