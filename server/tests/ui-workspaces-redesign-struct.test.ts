import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');

describe('Workspace route redesign structural', () => {
  it('converter is conversion board with stage/rail markers and preserved workspace hooks', () => {
    const src = read('src/views/ConverterView.jsx');
    assert.match(src, /conversion-board/);
    assert.match(src, /WorkspaceHeader/);
    assert.match(src, /WorkbenchLayout|workbench-stage|workbench-rail/);
    assert.match(src, /selectedGroupId|Convert selected/);
    assert.match(src, /useWorkspace/);
    assert.match(src, /skipUploadEffect|hydratedOnce|workspaceId/);
  });

  it('pdf is document page workspace preserving organizer and job options', () => {
    const src = read('src/views/PdfView.jsx');
    assert.match(src, /document-page-workspace/);
    assert.match(src, /WorkspaceHeader/);
    assert.match(src, /PdfPageOrganizer/);
    assert.match(src, /buildPdfJobOptions|validatePdfClient/);
  });

  it('image and media use canvas/timeline workbenches', () => {
    const image = read('src/views/ImageView.jsx');
    const media = read('src/views/MediaView.jsx');
    assert.match(image, /image-canvas-workspace/);
    assert.match(image, /WorkbenchLayout/);
    assert.match(image, /CompareSlider/);
    assert.match(media, /media-timeline-workspace/);
    assert.match(media, /WorkbenchLayout/);
    assert.match(media, /CapabilityBanner/);
    assert.match(media, /TimelineRange/);
  });

  it('qr uses inspector workspace header without dropping paste/decode contracts', () => {
    const src = read('src/views/QrView.jsx');
    assert.match(src, /qr-inspector-workspace|inspector-workspace/);
    assert.match(src, /WorkspaceHeader/);
    assert.match(src, /QrPasteModal/);
  });

  it('modular workspaces use FeatureRail workbench not illustration feature gallery', () => {
    const src = read('src/views/ModularWorkspaceView.jsx');
    assert.match(src, /modular-workbench/);
    assert.match(src, /WorkbenchLayout/);
    assert.match(src, /FeatureRail/);
    assert.match(src, /workbench-runbar|runbar/);
    assert.doesNotMatch(src, /IllustrationCard/);
    assert.doesNotMatch(src, /module-overview-grid/);
  });

  it('activity/settings/developer use operational headers', () => {
    assert.match(read('src/views/ActivityView.jsx'), /result-history-manager|WorkspaceHeader/);
    assert.match(read('src/views/ActivityView.jsx'), /activity-workspace/);
    assert.match(read('src/views/SettingsView.jsx'), /focused-settings-workspace/);
    assert.match(read('src/views/DeveloperView.jsx'), /developer-inspector|WorkspaceHeader/);
    assert.match(read('src/views/ProfileView.jsx'), /profile-workspace|WorkspaceHeader/);
  });

  it('specialized tools are dedicated views not modular shells', () => {
    for (const file of ['ArchiveView.jsx', 'TextView.jsx', 'ColorView.jsx', 'SecurityView.jsx']) {
      const src = read(`src/views/${file}`);
      assert.doesNotMatch(src, /ModularWorkspaceView/);
      assert.match(src, /WorkbenchLayout/);
      assert.match(src, /WorkspaceHeader/);
    }
  });
});
