import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  invalidateOptionalBinaries,
  probeOptionalBinary,
  resolveOptionalBinary,
} from '../src/tools/optional-binaries.js';

const originalPath = process.env.PATH;
const tempRoots: string[] = [];

function fakePdftoppm(exitCode: number): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-pdftoppm-'));
  tempRoots.push(root);
  const isWindows = process.platform === 'win32';
  const executable = path.join(
    root,
    isWindows && exitCode === 0 ? 'pdftoppm.exe' : isWindows ? 'pdftoppm.cmd' : 'pdftoppm',
  );
  const body = isWindows
    ? `@echo off\r\necho fake pdftoppm\r\nexit /b ${exitCode}\r\n`
    : `#!/bin/sh\necho "fake pdftoppm"\nexit ${exitCode}\n`;
  fs.writeFileSync(executable, body);
  if (!isWindows) fs.chmodSync(executable, 0o755);
  process.env.PATH = root;
  invalidateOptionalBinaries();
  return executable;
}

afterEach(() => {
  process.env.PATH = originalPath;
  invalidateOptionalBinaries();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('optional PDF binary probes', () => {
  it('does not publish a wrapper that exists but cannot run', () => {
    fakePdftoppm(1);
    const resolved = resolveOptionalBinary('pdftoppm', true);
    assert.equal(resolved.available, false);
    assert.equal(resolved.path, '');
  });

  it('accepts a candidate after a successful probe', () => {
    const probe = probeOptionalBinary(process.execPath, 'pdftoppm');
    assert.equal(probe.usable, true);
    assert.match(probe.version || '', /^v\d+/);
  });
});
