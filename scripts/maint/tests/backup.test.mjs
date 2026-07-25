/**
 * Drives the real backup.mjs entrypoint against a temporary DATA_DIR.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const scratchRoot = path.join(repoRoot, 'tmp', `backup-test-${process.pid}`);
const dataDir = path.join(scratchRoot, 'data');
const destDir = path.join(scratchRoot, 'out');

after(() => {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
});

describe('maint backup.mjs', () => {
  it('copies DATA_DIR into a stamped backup folder with meta', () => {
    fs.rmSync(scratchRoot, { recursive: true, force: true });
    fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'alphastudio.db'), 'sqlite-placeholder', 'utf8');
    fs.writeFileSync(path.join(dataDir, 'uploads', 'note.txt'), 'hello-backup', 'utf8');

    const script = path.join(repoRoot, 'scripts', 'maint', 'backup.mjs');
    const r = spawnSync(process.execPath, [script, '--dest', destDir], {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        DATA_DIR: dataDir,
      },
    });
    assert.equal(r.status, 0, `backup failed: ${r.stderr || r.stdout}`);
    assert.match(String(r.stdout || ''), /\[backup\] ok/);

    const stamped = fs
      .readdirSync(destDir)
      .filter((name) => name.startsWith('alphastudio-backup-'));
    assert.equal(stamped.length, 1, 'expected one stamped backup folder');
    const out = path.join(destDir, stamped[0]);
    assert.ok(fs.existsSync(path.join(out, 'data', 'alphastudio.db')));
    assert.equal(
      fs.readFileSync(path.join(out, 'data', 'uploads', 'note.txt'), 'utf8'),
      'hello-backup',
    );
    const meta = JSON.parse(fs.readFileSync(path.join(out, 'backup-meta.json'), 'utf8'));
    assert.equal(meta.dataDir, dataDir);
    assert.ok(meta.createdAt);
  });
});
