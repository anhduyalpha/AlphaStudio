import { isLibreOfficeInstallComplete, resolveTool } from '../../tools/registry.js';
import { formatFamily } from '../formats.js';
import type { ConversionEngineAdapter, EngineRouteCandidate } from './types.js';
import { validateRegisteredOutput } from './validation.js';

const SAFE_PAIRS: Record<string, string[]> = {
  doc: ['pdf', 'docx', 'odt', 'txt', 'html', 'rtf'],
  docx: ['pdf', 'odt', 'txt', 'html', 'rtf', 'doc'],
  odt: ['pdf', 'docx', 'txt', 'html', 'rtf'],
  rtf: ['pdf', 'docx', 'odt', 'txt', 'html'],
  xls: ['xlsx', 'ods', 'csv', 'pdf'],
  xlsx: ['ods', 'csv', 'pdf', 'xls'],
  ods: ['xlsx', 'csv', 'pdf'],
  csv: ['xlsx', 'ods', 'pdf'],
  tsv: ['xlsx', 'ods'],
  ppt: ['pdf', 'pptx', 'odp', 'png', 'jpeg'],
  pptx: ['pdf', 'odp', 'png', 'jpeg', 'ppt'],
  odp: ['pdf', 'pptx', 'png', 'jpeg'],
  txt: ['docx'],
  md: ['docx'],
  html: ['docx'],
  epub: ['pdf', 'txt', 'html'],
};

export const libreOfficeEngine: ConversionEngineAdapter = {
  id: 'libreoffice',
  name: 'LibreOffice',
  handler: 'libreoffice',
  supportedPlatforms: ['win32', 'linux', 'darwin'],
  executableCandidates: ['soffice.com', 'soffice', 'libreoffice'],
  profile: 'documents',
  approximateInstalledSizeMb: 1_500,
  defaultWorkerCategory: 'office',
  concurrencyLimit: 1,
  validateOutput: validateRegisteredOutput,
  probe: () => {
    const tool = resolveTool('libreoffice');
    const complete = tool.available && isLibreOfficeInstallComplete(tool.path);
    return {
      available: complete,
      executablePath: complete ? tool.path : undefined,
      version: tool.version,
      reason: complete
        ? undefined
        : tool.available
          ? 'LibreOffice installation is incomplete'
          : 'Install the documents profile to enable Office conversion',
    };
  },
  discoverCapabilities: (probe) => {
    const routes: EngineRouteCandidate[] = [];
    for (const [input, outputs] of Object.entries(SAFE_PAIRS)) {
      for (const output of outputs) {
        routes.push({
          input,
          output,
          inputFamily: formatFamily(input),
          outputFamily: formatFamily(output),
          priority: input === 'epub' ? 80 : 50,
          cost: 'high',
          workerCategory: 'office',
          requiredCompanions: ['libreoffice'],
          supported: probe.available,
          reason: probe.available
            ? undefined
            : 'LibreOffice is unavailable or incomplete',
        });
      }
    }
    return {
      readableFormats: probe.available ? Object.keys(SAFE_PAIRS) : [],
      writableFormats: probe.available
        ? [...new Set(Object.values(SAFE_PAIRS).flat())]
        : [],
      routes,
      notes: [
        'Routes use the existing AlphaStudio Office allowlist.',
        'PDF input and same-format Office conversions are always denied.',
      ],
    };
  },
};
