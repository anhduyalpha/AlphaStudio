import {
  hasPdfRasterizer,
  resolveAllOptionalBinaries,
} from '../../tools/optional-binaries.js';
import type { ConversionEngineAdapter } from './types.js';
import { validateRegisteredOutput } from './validation.js';

export const pdfRasterizerEngine: ConversionEngineAdapter = {
  id: 'pdf-rasterizer',
  name: 'PDF Rasterizer',
  handler: 'pdf',
  supportedPlatforms: ['win32', 'linux', 'darwin'],
  executableCandidates: ['pdftoppm', 'mutool', 'gs', 'gswin64c'],
  profile: 'core',
  defaultWorkerCategory: 'pdf',
  concurrencyLimit: 2,
  validateOutput: validateRegisteredOutput,
  probe: () => {
    const tools = resolveAllOptionalBinaries();
    const selected = tools.pdftoppm.available
      ? tools.pdftoppm
      : tools.mutool.available
        ? tools.mutool
        : tools.ghostscript;
    return {
      available: hasPdfRasterizer(),
      executablePath: selected.path || undefined,
      version: selected.version,
      reason: hasPdfRasterizer()
        ? undefined
        : 'Install pdftoppm, MuPDF, or Ghostscript for PDF image output',
    };
  },
  discoverCapabilities: (probe) => ({
    readableFormats: probe.available ? ['pdf'] : [],
    writableFormats: probe.available ? ['png', 'jpeg'] : [],
    routes: ['png', 'jpeg'].map((output) => ({
      input: 'pdf',
      output,
      inputFamily: 'pdf',
      outputFamily: 'image',
      priority: 10,
      cost: 'high' as const,
      workerCategory: 'pdf' as const,
      supported: probe.available,
      reason: probe.available
        ? undefined
        : 'PDF to images needs pdftoppm, mutool, or Ghostscript',
    })),
  }),
};
