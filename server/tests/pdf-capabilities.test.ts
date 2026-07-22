import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectCapabilities } from '../src/capabilities.js';
import { capabilityIdFor } from '../src/processors/index.js';
import { PDF_OPERATION_DESCRIPTORS } from '../src/pdf/operation-contract.js';

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
    assert.equal(capabilityIdFor('pdf', { operation: 'compress' }), null);
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

  it('publishes authoritative operation descriptors with safe execution contracts', () => {
    assert.ok(PDF_OPERATION_DESCRIPTORS.length > 0);
    const ids = new Set<string>();
    for (const operation of PDF_OPERATION_DESCRIPTORS) {
      assert.ok(operation.id);
      assert.ok(operation.capability.startsWith('pdf.'));
      assert.ok(!ids.has(operation.id), `duplicate operation id ${operation.id}`);
      ids.add(operation.id);
      assert.ok(operation.cardinality.minFiles >= 1);
      if (operation.cardinality.maxFiles != null) {
        assert.ok(operation.cardinality.maxFiles >= operation.cardinality.minFiles);
      }
      assert.ok(Array.isArray(operation.options));
      assert.ok(operation.outputKinds.length > 0);
      assert.ok(operation.enginePolicy.engines.length > 0);
    }

    const merge = PDF_OPERATION_DESCRIPTORS.find((operation) => operation.id === 'merge');
    assert.deepEqual(merge?.cardinality, { minFiles: 2, maxFiles: 20 });
    const advanced = PDF_OPERATION_DESCRIPTORS.find(
      (operation) => operation.id === 'compress-advanced',
    );
    assert.deepEqual(advanced?.enginePolicy.engines, ['ghostscript']);
    assert.equal(advanced?.enginePolicy.fallback, 'none');
  });

  it('reports complete PDF binary status and never advertises decrypt', () => {
    const caps = detectCapabilities(true);
    assert.equal(typeof caps.binaries.pdftoppm.available, 'boolean');
    assert.equal(typeof caps.binaries.ghostscript.available, 'boolean');
    assert.equal(typeof caps.binaries.qpdf.available, 'boolean');

    const decrypt = caps.tools.find((tool) => tool.id === 'pdf.decrypt');
    assert.equal(decrypt?.available, false);
    assert.match(String(decrypt?.reason), /not implemented/i);
    assert.equal(
      PDF_OPERATION_DESCRIPTORS.some((operation) => operation.id === 'decrypt'),
      false,
      'unimplemented decrypt must not be advertised as an accepted operation',
    );

    const advanced = caps.tools.find((tool) => tool.id === 'pdf.compress.advanced');
    assert.equal(advanced?.available, caps.binaries.ghostscript.available);
    assert.deepEqual(advanced?.requires, ['ghostscript']);
    assert.ok(advanced?.available || /Ghostscript/i.test(String(advanced?.reason)));
  });
});
