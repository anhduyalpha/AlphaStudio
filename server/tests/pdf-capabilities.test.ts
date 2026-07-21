import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectCapabilities } from '../src/capabilities.js';
import { capabilityIdFor } from '../src/processors/index.js';

const REQUIRED = [
  'pdf.merge',
  'pdf.split',
  'pdf.rotate',
  'pdf.reorder',
  'pdf.extract',
  'pdf.delete-pages',
  'pdf.duplicate-pages',
  'pdf.from-images',
  'pdf.to-images',
  'pdf.to-text',
  'pdf.ocr',
  'pdf.compress.structural',
  'pdf.compress.advanced',
  'pdf.inspect',
  'pdf.repair',
  'pdf.decrypt',
];

describe('PDF capabilities', () => {
  it('exposes full pdf.* capability set with available/reason/requires', () => {
    const caps = detectCapabilities(true);
    for (const id of REQUIRED) {
      const tool = caps.tools.find((t) => t.id === id);
      assert.ok(tool, `missing capability ${id}`);
      assert.equal(typeof tool.available, 'boolean', id);
      assert.ok(Array.isArray(tool.requires) || tool.requires === undefined, id);
      if (!tool.available) {
        assert.ok(tool.reason, `${id} should explain unavailability`);
      }
    }
  });

  it('maps operations to capability ids', () => {
    assert.equal(capabilityIdFor('pdf', { operation: 'merge' }), 'pdf.merge');
    assert.equal(capabilityIdFor('pdf', { operation: 'delete-pages' }), 'pdf.delete-pages');
    assert.equal(capabilityIdFor('pdf', { operation: 'compress-advanced' }), 'pdf.compress.advanced');
    assert.equal(capabilityIdFor('pdf', { operation: 'compress' }), 'pdf.compress.structural');
    assert.equal(capabilityIdFor('pdf', { operation: 'ocr' }), 'pdf.ocr');
    assert.equal(capabilityIdFor('pdf', { operation: 'inspect' }), 'pdf.inspect');
    assert.equal(capabilityIdFor('pdf', { operation: 'repair' }), 'pdf.repair');
  });

  it('searchable OCR is honestly unavailable', () => {
    const caps = detectCapabilities(true);
    const tool = caps.tools.find((t) => t.id === 'pdf.ocr.searchable');
    assert.ok(tool);
    assert.equal(tool.available, false);
  });
});
