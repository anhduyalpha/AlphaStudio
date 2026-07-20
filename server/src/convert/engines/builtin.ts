import sharp from 'sharp';
import { formatFamily, normalizeFormat } from '../formats.js';
import type {
  ConversionEngineAdapter,
  EngineRouteCandidate,
} from './types.js';
import { validateRegisteredOutput } from './validation.js';

const IMAGE_POLICY: Record<string, string[]> = {
  png: ['jpeg', 'webp', 'avif', 'gif', 'tiff', 'bmp', 'pdf', 'ico'],
  jpeg: ['png', 'webp', 'avif', 'gif', 'tiff', 'bmp', 'pdf', 'ico'],
  webp: ['png', 'jpeg', 'avif', 'gif', 'tiff', 'bmp', 'pdf'],
  avif: ['png', 'jpeg', 'webp', 'gif', 'tiff', 'pdf'],
  gif: ['png', 'jpeg', 'webp', 'pdf'],
  tiff: ['png', 'jpeg', 'webp', 'pdf'],
  bmp: ['png', 'jpeg', 'webp', 'pdf'],
  ico: ['png', 'jpeg', 'webp'],
  svg: ['png', 'jpeg', 'webp', 'pdf'],
  heic: ['png', 'jpeg', 'webp', 'pdf'],
  heif: ['png', 'jpeg', 'webp', 'pdf'],
};

const PURE_ROUTES: Array<[string, string, 'image' | 'pdf' | 'general']> = [
  ['zip', 'tar', 'general'],
  ['zip', 'gz', 'general'],
  ['tar', 'zip', 'general'],
  ['tar', 'gz', 'general'],
  ['gz', 'zip', 'general'],
  ['gz', 'tar', 'general'],
  ['tgz', 'zip', 'general'],
  ['tgz', 'tar', 'general'],
  ['csv', 'tsv', 'general'],
  ['csv', 'txt', 'general'],
  ['tsv', 'csv', 'general'],
  ['tsv', 'txt', 'general'],
  ['txt', 'md', 'general'],
  ['txt', 'html', 'general'],
  ['txt', 'pdf', 'pdf'],
  ['md', 'txt', 'general'],
  ['md', 'html', 'general'],
  ['md', 'pdf', 'pdf'],
  ['html', 'txt', 'general'],
  ['html', 'md', 'general'],
  ['html', 'pdf', 'pdf'],
  ['pdf', 'txt', 'pdf'],
];

type SharpFormatStatus = {
  input?: { file?: boolean; buffer?: boolean };
  output?: { file?: boolean; buffer?: boolean };
};

function sharpStatus(format: string): SharpFormatStatus | undefined {
  const token = normalizeFormat(format);
  const sharpToken = token === 'jpeg' ? 'jpeg' : token === 'tiff' ? 'tiff' : token;
  return (sharp.format as unknown as Record<string, SharpFormatStatus>)[sharpToken];
}

function sharpCanRead(format: string): boolean {
  if (format === 'bmp' || format === 'ico') return Boolean(sharpStatus(format)?.input);
  const status = sharpStatus(format);
  return Boolean(status?.input?.file || status?.input?.buffer);
}

function sharpCanWrite(format: string): boolean {
  if (format === 'bmp' || format === 'ico') return true;
  const status = sharpStatus(format);
  return Boolean(status?.output?.file || status?.output?.buffer);
}

function route(
  input: string,
  output: string,
  workerCategory: 'image' | 'pdf' | 'general',
  supported = true,
  reason?: string,
): EngineRouteCandidate {
  return {
    input,
    output,
    inputFamily: formatFamily(input),
    outputFamily: formatFamily(output),
    priority: 10,
    cost: workerCategory === 'general' ? 'low' : 'medium',
    workerCategory,
    supported,
    reason,
  };
}

export const builtinEngine: ConversionEngineAdapter = {
  id: 'alphastudio',
  name: 'AlphaStudio Built-in',
  handler: 'builtin',
  supportedPlatforms: ['win32', 'linux', 'darwin'],
  executableCandidates: [],
  profile: 'core',
  approximateInstalledSizeMb: 0,
  defaultWorkerCategory: 'general',
  concurrencyLimit: 4,
  validateOutput: validateRegisteredOutput,
  probe: () => ({
    available: true,
    version: `sharp ${sharp.versions.sharp || 'bundled'} / pdf-lib`,
  }),
  discoverCapabilities: () => {
    const routes: EngineRouteCandidate[] = [];
    for (const [input, outputs] of Object.entries(IMAGE_POLICY)) {
      const readable = sharpCanRead(input);
      for (const output of outputs) {
        const writable = output === 'pdf' || sharpCanWrite(output);
        const supported = readable && writable;
        routes.push(
          route(
            input,
            output,
            output === 'pdf' ? 'pdf' : 'image',
            supported,
            supported
              ? undefined
              : `The bundled Sharp build cannot ${readable ? 'write' : 'read'} this format`,
          ),
        );
      }
    }
    for (const [input, output, category] of PURE_ROUTES) {
      routes.push(route(input, output, category));
    }
    routes.push(
      route(
        'pdf',
        'docx',
        'pdf',
        false,
        'PDF → DOCX is intentionally unavailable in Phase 1; PDF input is never routed through LibreOffice',
      ),
    );
    return {
      readableFormats: [...new Set(routes.filter((item) => item.supported).map((item) => item.input))],
      writableFormats: [...new Set(routes.filter((item) => item.supported).map((item) => item.output))],
      routes,
      notes: ['Built-in routes are an explicit safe policy; no format cross-product is generated.'],
    };
  },
};
