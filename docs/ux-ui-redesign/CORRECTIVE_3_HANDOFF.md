# Corrective Phase 3 Handoff — PDF document workspace

## Composition
- SegmentedControl for Organize / Convert / Optimize / Analyze groups
- WorkbenchLayout:
  - **Stage:** documents FilePicker + **page canvas always when file present** (PdfPageOrganizer not Preview-tab only) + operation options + inspect panel
  - **Rail:** run status / engine / capabilities
  - **Runbar:** single Run PDF operation / Cancel
- Removed duplicate primary/cancel in header (e2e strict mode)

## Backend preserved
PdfPageOrganizer lifecycle, pdfJobOptions, capabilities, e2e green (5/5 including screenshot harness).

## Tests
ui-pdf-struct, e2e pdf-tools + baseline screenshots
