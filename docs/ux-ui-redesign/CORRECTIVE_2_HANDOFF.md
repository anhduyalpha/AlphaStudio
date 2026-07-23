# Corrective Phase 2 Handoff — Converter board

## Composition change (not class rename)
- `WorkbenchLayout` with:
  - **Stage:** upload/input partition, selectable detected groups (`FileRow`), selected group members, needs-attention fails
  - **Rail:** target settings only for **selected** group (format, quality, metadata, engine summary)
  - **Runbar:** Convert selected / Cancel with progress wave
  - **Footer:** ResultPanel for converted files (existing download/zip/filter logic)
- `selectedGroupId` drives contextual rail (progressive disclosure)

## Backend preserved
useWorkspace, SSE, hydrate, group convert, zip, result filters, skip re-upload.

## Tests
ui-converter-struct, ui-converter-pro, ui-workspace, ui-live-converter, ui-workspaces-redesign — pass

## Residual
Full after-screenshot matrix in C9; further polish batch convert-all optional.
