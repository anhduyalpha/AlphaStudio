export type ProgressFn = (progress: number, message?: string) => void;

export type ProcessContext = {
  jobId: string;
  inputPaths: string[];
  inputNames: string[];
  options: Record<string, unknown>;
  workDir: string;
  outputDir: string;
  onProgress: ProgressFn;
  isCancelled: () => boolean;
  /**
   * Optional preloaded detect metadata aligned with inputPaths
   * (from files.detect_json / uploads). Processors may skip re-detect.
   */
  inputDetects?: Array<Record<string, unknown> | null>;
};

export type ProcessResult = {
  outputPath: string;
  outputName: string;
  outputMime: string;
  meta?: Record<string, unknown>;
};

export type Processor = (ctx: ProcessContext) => Promise<ProcessResult>;
