import { resolveTool } from '../../tools/registry.js';
import { formatFamily } from '../formats.js';
import type { ConversionEngineAdapter, EngineRouteCandidate } from './types.js';
import { validateRegisteredOutput } from './validation.js';

const INPUTS = ['bz2', 'xz', '7z'];
const OUTPUTS = ['zip', 'tar', '7z'];

export const sevenZipEngine: ConversionEngineAdapter = {
  id: 'sevenzip',
  name: '7-Zip',
  handler: 'archive',
  supportedPlatforms: ['win32', 'linux', 'darwin'],
  executableCandidates: ['7z', '7za', '7zz'],
  profile: 'core',
  approximateInstalledSizeMb: 8,
  defaultWorkerCategory: 'general',
  concurrencyLimit: 2,
  validateOutput: validateRegisteredOutput,
  probe: () => {
    const tool = resolveTool('7z');
    return {
      available: tool.available,
      executablePath: tool.path || undefined,
      version: tool.version,
      reason: tool.available
        ? undefined
        : '7-Zip is not installed; install the core profile for 7Z/XZ/BZ2 conversions',
    };
  },
  discoverCapabilities: (probe) => {
    const routes: EngineRouteCandidate[] = [];
    for (const input of [...INPUTS, 'zip', 'tar', 'gz', 'tgz']) {
      for (const output of OUTPUTS) {
        if (input === output) continue;
        if (!INPUTS.includes(input) && output !== '7z') continue;
        routes.push({
          input,
          output,
          inputFamily: formatFamily(input),
          outputFamily: formatFamily(output),
          priority: 30,
          cost: 'medium',
          workerCategory: 'general',
          requiredCompanions: ['7z'],
          supported: probe.available,
          reason: probe.available ? undefined : '7-Zip is required for this archive pair',
        });
      }
    }
    return {
      readableFormats: probe.available ? [...INPUTS, 'zip', 'tar', 'gz', 'tgz'] : [],
      writableFormats: probe.available ? OUTPUTS : [],
      routes,
    };
  },
};
