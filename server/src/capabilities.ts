import { execFileSync } from 'node:child_process';
import { logger } from './lib/logger.js';
import { resolveAllTools } from './tools/registry.js';
import {
  hasOcrStack,
  hasPdfRasterizer,
  resolveAllOptionalBinaries,
} from './tools/optional-binaries.js';

export type BinaryStatus = {
  name: string;
  available: boolean;
  path?: string;
  version?: string;
};

export type ToolCapability = {
  id: string;
  label: string;
  available: boolean;
  reason?: string;
  requires?: string[];
};

function detectBinary(name: string, args: string[] = ['-version']): BinaryStatus {
  try {
    const out = execFileSync(name, args, {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const first = String(out).split(/\r?\n/)[0]?.trim() || undefined;
    return { name, available: true, path: name, version: first };
  } catch {
    // try --version for some tools
    try {
      const out = execFileSync(name, ['--version'], {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const first = String(out).split(/\r?\n/)[0]?.trim() || undefined;
      return { name, available: true, path: name, version: first };
    } catch {
      return { name, available: false };
    }
  }
}

let cached: {
  binaries: Record<string, BinaryStatus>;
  tools: ToolCapability[];
  detectedAt: string;
} | null = null;

// These processors are bundled JavaScript/native dependencies. They should not
// wait for the external-tool probe before a job can be queued (notably QR).
const BUNDLED_CAPABILITIES = new Set([
  'text.format-json',
  'text.base64',
  'text.url',
  'text.hash',
  'text.cleanup',
  'qr.generate',
  'qr.decode',
  'image.resize',
  'image.crop',
  'image.rotate',
  'image.convert',
  'image.compress',
  'image.strip-metadata',
  'pdf.merge',
  'pdf.split',
  'pdf.rotate',
  'pdf.reorder',
  'pdf.compress',
  'pdf.extract',
  'pdf.from-images',
  'pdf.to-text',
  'converter.batch',
  'archive.zip',
  'archive.tar',
  'archive.gz',
  'security.hash',
  'security.signature',
  'security.metadata',
]);

export function detectCapabilities(force = false) {
  if (cached && !force) return cached;

  // Prefer project-local .tools registry (cache-first; force re-probes binaries)
  const all = resolveAllTools(force);
  const ffmpeg: BinaryStatus = {
    name: 'ffmpeg',
    available: all.ffmpeg.available,
    path: all.ffmpeg.path || undefined,
    version: all.ffmpeg.version,
  };
  const ffprobe: BinaryStatus = {
    name: 'ffprobe',
    available: all.ffprobe.available,
    path: all.ffprobe.path || undefined,
    version: all.ffprobe.version,
  };
  const sevenZa: BinaryStatus = {
    name: '7z',
    available: all['7z'].available,
    path: all['7z'].path || undefined,
    version: all['7z'].version,
  };
  const libreoffice: BinaryStatus = {
    name: 'libreoffice',
    available: all.libreoffice.available,
    path: all.libreoffice.path || undefined,
    version: all.libreoffice.version,
  };
  const pandoc: BinaryStatus = {
    name: 'pandoc',
    available: all.pandoc.available,
    path: all.pandoc.path || undefined,
    version: all.pandoc.version,
  };
  const calibre: BinaryStatus = {
    name: 'calibre',
    available: all.calibre.available,
    path: all.calibre.path || undefined,
    version: all.calibre.version,
  };

  const optional = resolveAllOptionalBinaries(force);
  const binaries = {
    ffmpeg,
    ffprobe,
    '7z': sevenZa,
    libreoffice,
    pandoc,
    calibre,
    sharp: { name: 'sharp', available: true, version: 'bundled' } as BinaryStatus,
    pdfLib: { name: 'pdf-lib', available: true, version: 'bundled' } as BinaryStatus,
    pdftotext: {
      name: 'pdftotext',
      available: optional.pdftotext.available,
      path: optional.pdftotext.path || undefined,
      version: optional.pdftotext.version,
    } as BinaryStatus,
    mutool: {
      name: 'mutool',
      available: optional.mutool.available,
      path: optional.mutool.path || undefined,
      version: optional.mutool.version,
    } as BinaryStatus,
    tesseract: {
      name: 'tesseract',
      available: optional.tesseract.available,
      path: optional.tesseract.path || undefined,
      version: optional.tesseract.version,
    } as BinaryStatus,
    pdfRasterizer: {
      name: 'pdf-rasterizer',
      available: hasPdfRasterizer(),
      version: hasPdfRasterizer() ? 'external' : undefined,
    } as BinaryStatus,
  };

  const mediaOk = ffmpeg.available && ffprobe.available;
  const archive7zOk = sevenZa.available;
  const officeOk = libreoffice.available;

  const tools: ToolCapability[] = [
    { id: 'text.format-json', label: 'JSON format', available: true },
    { id: 'text.base64', label: 'Base64 encode/decode', available: true },
    { id: 'text.url', label: 'URL encode/decode', available: true },
    { id: 'text.hash', label: 'Hashes', available: true },
    { id: 'text.cleanup', label: 'Text cleanup', available: true },
    { id: 'qr.generate', label: 'QR generate PNG/SVG', available: true },
    { id: 'qr.decode', label: 'QR decode', available: true },
    { id: 'image.resize', label: 'Image resize', available: true, requires: ['sharp'] },
    { id: 'image.crop', label: 'Image crop', available: true, requires: ['sharp'] },
    { id: 'image.rotate', label: 'Image rotate', available: true, requires: ['sharp'] },
    { id: 'image.convert', label: 'Image convert', available: true, requires: ['sharp'] },
    { id: 'image.compress', label: 'Image compress/optimize', available: true, requires: ['sharp'] },
    { id: 'image.strip-metadata', label: 'Strip image metadata', available: true, requires: ['sharp'] },
    { id: 'pdf.merge', label: 'PDF merge', available: true, requires: ['pdf-lib'] },
    { id: 'pdf.split', label: 'PDF split', available: true, requires: ['pdf-lib'] },
    { id: 'pdf.rotate', label: 'PDF rotate', available: true, requires: ['pdf-lib'] },
    { id: 'pdf.reorder', label: 'PDF reorder', available: true, requires: ['pdf-lib'] },
    {
      id: 'pdf.compress',
      label: 'PDF structural optimize',
      available: true,
      reason: 'Structural optimization only (object streams); image re-encoding requires a rasterizer',
      requires: ['pdf-lib'],
    },
    { id: 'pdf.extract', label: 'PDF extract pages', available: true, requires: ['pdf-lib'] },
    {
      id: 'pdf.to-images',
      label: 'PDF to images',
      available: hasPdfRasterizer(),
      reason: hasPdfRasterizer()
        ? undefined
        : 'Requires pdftoppm, mutool, or Ghostscript (LibreOffice is not used for PDF input)',
      requires: ['pdf-rasterizer'],
    },
    {
      id: 'pdf.to-text',
      label: 'PDF text extraction',
      available: true,
      reason: 'Native/pdftotext; OCR optional when Tesseract + rasterizer present',
      requires: ['pdf-text'],
    },
    {
      id: 'pdf.ocr',
      label: 'PDF OCR',
      available: hasOcrStack(),
      reason: hasOcrStack()
        ? undefined
        : 'OCR requires Tesseract and a PDF rasterizer',
      requires: ['tesseract', 'pdf-rasterizer'],
    },
    { id: 'pdf.from-images', label: 'Images to PDF', available: true, requires: ['pdf-lib', 'sharp'] },
    {
      id: 'converter.batch',
      label: 'Universal conversion',
      available: true,
    },
    {
      id: 'converter.office',
      label: 'Office document conversion',
      available: officeOk,
      reason: officeOk ? undefined : 'LibreOffice (soffice) not found. Run npm run setup:tools.',
      requires: ['libreoffice'],
    },
    { id: 'archive.zip', label: 'ZIP create/extract', available: true },
    { id: 'archive.tar', label: 'TAR create/extract', available: true },
    { id: 'archive.gz', label: 'GZ compress/decompress', available: true },
    {
      id: 'archive.7z',
      label: '7Z create/extract',
      available: archive7zOk,
      reason: archive7zOk ? undefined : '7z binary not found on PATH',
      requires: ['7z'],
    },
    { id: 'security.hash', label: 'File checksums', available: true },
    { id: 'security.signature', label: 'File magic signature', available: true },
    { id: 'security.metadata', label: 'Metadata inspection', available: true },
    {
      id: 'media.inspect',
      label: 'Media inspect',
      available: ffprobe.available,
      reason: ffprobe.available ? undefined : 'ffprobe not found on PATH',
      requires: ['ffprobe'],
    },
    {
      id: 'media.trim',
      label: 'Media trim',
      available: mediaOk,
      reason: mediaOk ? undefined : 'ffmpeg/ffprobe not found on PATH',
      requires: ['ffmpeg', 'ffprobe'],
    },
    {
      id: 'media.transcode',
      label: 'Media transcode',
      available: mediaOk,
      reason: mediaOk ? undefined : 'ffmpeg/ffprobe not found on PATH',
      requires: ['ffmpeg', 'ffprobe'],
    },
    {
      id: 'media.extract-audio',
      label: 'Extract audio',
      available: mediaOk,
      reason: mediaOk ? undefined : 'ffmpeg/ffprobe not found on PATH',
      requires: ['ffmpeg', 'ffprobe'],
    },
    {
      id: 'audio.convert',
      label: 'Audio convert',
      available: mediaOk,
      reason: mediaOk ? undefined : 'ffmpeg not found on PATH',
      requires: ['ffmpeg'],
    },
    {
      id: 'audio.trim',
      label: 'Audio trim',
      available: mediaOk,
      reason: mediaOk ? undefined : 'ffmpeg not found on PATH',
      requires: ['ffmpeg'],
    },
    {
      id: 'audio.normalize',
      label: 'Audio normalize',
      available: mediaOk,
      reason: mediaOk ? undefined : 'ffmpeg not found on PATH',
      requires: ['ffmpeg'],
    },
    {
      id: 'text.ocr',
      label: 'OCR',
      available: hasOcrStack(),
      reason: hasOcrStack() ? undefined : 'OCR engine (Tesseract + rasterizer) not found',
    },
    { id: 'audio.extract-vocals', label: 'Vocal separation', available: false, reason: 'ML vocal separation not supported' },
  ];

  cached = {
    binaries,
    tools,
    detectedAt: new Date().toISOString(),
  };
  logger.info(
    {
      ffmpeg: ffmpeg.available,
      ffprobe: ffprobe.available,
      sevenZ: archive7zOk,
    },
    'Capabilities detected',
  );
  return cached;
}

export function isToolAvailable(toolId: string): { available: boolean; reason?: string } {
  if (BUNDLED_CAPABILITIES.has(toolId)) return { available: true };
  const caps = detectCapabilities();
  const tool = caps.tools.find((t) => t.id === toolId);
  if (!tool) return { available: false, reason: `Unknown tool: ${toolId}` };
  return { available: tool.available, reason: tool.reason };
}

export function requireTool(toolId: string): void {
  const { available, reason } = isToolAvailable(toolId);
  if (!available) {
    const { unavailable } = require('./lib/errors.js') as typeof import('./lib/errors.js');
    throw unavailable(toolId, reason);
  }
}
