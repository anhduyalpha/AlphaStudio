import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Activity, {
  formatActivityTime,
  optimisticallyRemoveActivity,
  rollbackActivityRemoval,
} from '../next/views/Activity.jsx';

const APP_SOURCE = readFileSync(
  fileURLToPath(new URL('../next/App.jsx', import.meta.url)),
  'utf8',
);
const ACTIVITY_SOURCE = readFileSync(
  fileURLToPath(new URL('../next/views/Activity.jsx', import.meta.url)),
  'utf8',
);

describe('V2 Activity optimistic history', () => {
  it('removes one row immediately and records its exact rollback position', () => {
    const rows = [
      { id: 'one', action: 'First' },
      { id: 'two', action: 'Second' },
      { id: 'three', action: 'Third' },
    ];
    const removal = optimisticallyRemoveActivity(rows, 'two');
    expect(removal.rows.map((row) => row.id)).toEqual(['one', 'three']);
    expect(removal.rollback).toEqual({ row: rows[1], index: 1 });
    expect(rows.map((row) => row.id)).toEqual(['one', 'two', 'three']);
  });

  it('rolls a failed delete back without losing newer rows', () => {
    const original = [
      { id: 'one', action: 'First' },
      { id: 'two', action: 'Second' },
      { id: 'three', action: 'Third' },
    ];
    const removal = optimisticallyRemoveActivity(original, 'two');
    const restored = rollbackActivityRemoval(
      [...removal.rows, { id: 'four', action: 'Newer' }],
      removal.rollback,
    );
    expect(restored.map((row) => row.id)).toEqual(['one', 'two', 'three', 'four']);
    expect(rollbackActivityRemoval(restored, removal.rollback)).toBe(restored);
  });

  it('keeps unknown row deletes as a stable no-op', () => {
    const rows = [{ id: 'one' }];
    expect(optimisticallyRemoveActivity(rows, 'missing')).toEqual({
      rows,
      rollback: null,
    });
  });

  it('formats valid timestamps and preserves invalid input honestly', () => {
    expect(formatActivityTime('not-a-date')).toBe('not-a-date');
    expect(formatActivityTime('2026-07-28T06:30:00.000Z')).toMatch(/2026/);
  });
});

describe('V2 Activity view wiring', () => {
  it('mounts Activity at #/activity and reads history directly through client wrappers', () => {
    expect(APP_SOURCE).toContain("import Activity from './views/Activity.jsx'");
    expect(APP_SOURCE).toContain("route.id === 'activity'");
    expect(APP_SOURCE).toContain('<Activity />');
    expect(ACTIVITY_SOURCE).toContain('api.getActivity(100)');
    expect(ACTIVITY_SOURCE).toContain('api.deleteActivity(row.id, { withJob: true })');
    expect(ACTIVITY_SOURCE).toContain('api.clearActivity()');
    expect(ACTIVITY_SOURCE).not.toContain('useStore(');
    expect(ACTIVITY_SOURCE).not.toMatch(/\b(fetch|XMLHttpRequest|EventSource)\s*\(/);
  });

  it('renders a designed loading state before the first history response', () => {
    const html = renderToStaticMarkup(<Activity />);
    expect(html).toContain('Result history');
    expect(html).toContain('Loading activity history');
    expect(html).toContain('Clear history');
  });
});
