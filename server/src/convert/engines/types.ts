import type { JobCategory } from '../../config.js';
import type { Family } from '../formats.js';

export type ToolProfile = 'core' | 'media' | 'documents' | 'ebooks';
export type ConversionCost = 'low' | 'medium' | 'high';

export type EngineProbeResult = {
  available: boolean;
  executablePath?: string;
  version?: string;
  reason?: string;
};

export type EngineRouteMetadata = {
  reader?: string;
  writer?: string;
  demuxer?: string;
  muxer?: string;
  audioEncoder?: string;
  videoEncoder?: string;
  inputCodecs?: string[];
  [key: string]: unknown;
};

export type EngineRouteCandidate = {
  input: string;
  output: string;
  inputFamily?: Family;
  outputFamily?: Family;
  priority: number;
  cost: ConversionCost;
  workerCategory: JobCategory;
  requiredCompanions?: string[];
  supported: boolean;
  reason?: string;
  metadata?: EngineRouteMetadata;
};

export type EngineDiscoveryResult = {
  readableFormats: string[];
  writableFormats: string[];
  routes: EngineRouteCandidate[];
  notes?: string[];
};

export type ConversionEngineAdapter = {
  id: string;
  name: string;
  /** Stable dispatch handler; never contains a command line or user input. */
  handler: string;
  supportedPlatforms: NodeJS.Platform[];
  executableCandidates: string[];
  profile: ToolProfile;
  approximateInstalledSizeMb?: number;
  defaultWorkerCategory: JobCategory;
  concurrencyLimit: number;
  validateOutput(outputPath: string, outputFormat: string): void;
  probe(): EngineProbeResult;
  discoverCapabilities(probe: EngineProbeResult): EngineDiscoveryResult;
};

export type EngineStatus = {
  id: string;
  name: string;
  available: boolean;
  version?: string;
  reason?: string;
  profile: ToolProfile;
  supported: boolean;
  approximateInstalledSizeMb?: number;
  workerCategory: JobCategory;
  concurrencyLimit: number;
  readableFormats: string[];
  writableFormats: string[];
  notes?: string[];
};

export type EngineRoute = Omit<EngineRouteCandidate, 'supported'> & {
  engineId: string;
  engineName: string;
  profile: ToolProfile;
  available: boolean;
  version?: string;
  handler: string;
};

export type CapabilitySnapshot = {
  generatedAt: string;
  expiresAt: string;
  engines: EngineStatus[];
  routes: EngineRoute[];
};
