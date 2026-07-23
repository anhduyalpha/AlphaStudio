import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');

describe('Manage routes polish structural (RQ10)', () => {
  it('Developer surfaces error, empty output, and JSON-only options', () => {
    const src = read('src/views/DeveloperView.jsx');
    assert.match(src, /developer-error/);
    assert.match(src, /developer-output/);
    assert.match(src, /needsJsonOptions/);
    assert.match(src, /developer-json-options/);
  });

  it('Activity empty state uses EmptyState', () => {
    const src = read('src/views/ActivityView.jsx');
    assert.match(src, /activity-empty/);
    assert.match(src, /EmptyState/);
  });

  it('Profile and Settings gate save on dirty state', () => {
    const profile = read('src/views/ProfileView.jsx');
    const settings = read('src/views/SettingsView.jsx');
    assert.match(profile, /dirty/);
    assert.match(profile, /profile-save/);
    assert.match(settings, /dirty/);
    assert.match(settings, /settings-save/);
    assert.match(settings, /dataset\.motion|data-motion/);
  });
});
