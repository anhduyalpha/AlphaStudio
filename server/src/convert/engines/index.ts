import { builtinEngine } from './builtin.js';
import { calibreEngine } from './calibre.js';
import { ffmpegEngine } from './ffmpeg.js';
import { libreOfficeEngine } from './libreoffice.js';
import { pandocEngine } from './pandoc.js';
import { pdfRasterizerEngine } from './pdf.js';
import {
  createDefaultRegistry,
  getEngineRegistry,
  setDefaultEngineRegistry,
} from './registry.js';
import { sevenZipEngine } from './sevenzip.js';

const registry = createDefaultRegistry([
  builtinEngine,
  ffmpegEngine,
  pandocEngine,
  libreOfficeEngine,
  calibreEngine,
  pdfRasterizerEngine,
  sevenZipEngine,
]);

setDefaultEngineRegistry(registry);

export function capabilitySnapshot(force = false) {
  return getEngineRegistry().getSnapshot(force);
}

export function conversionRoutes(
  inputFormat: string,
  outputFormat: string,
  includeUnavailable = false,
) {
  return getEngineRegistry().routesFor(inputFormat, outputFormat, includeUnavailable);
}

export * from './types.js';
export * from './registry.js';
export * from './ffmpeg.js';
export * from './pandoc.js';
export * from './calibre.js';
export * from './errors.js';
export * from './validation.js';
export * from './fallback.js';
