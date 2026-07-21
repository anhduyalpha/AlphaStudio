import type { ProcessContext, ProcessResult } from '../processors/types.js';
import type { ProgressTracker } from './progress.js';

export type { ProcessContext, ProcessResult };

/** Canonical PDF operation ids */
export type PdfOperation =
  | 'merge'
  | 'split'
  | 'rotate'
  | 'reorder'
  | 'extract'
  | 'delete-pages'
  | 'duplicate-pages'
  | 'from-images'
  | 'to-images'
  | 'to-text'
  | 'extract-text'
  | 'ocr'
  | 'compress'
  | 'compress-structural'
  | 'compress-advanced'
  | 'inspect'
  | 'repair';

export type PdfOpContext = ProcessContext & {
  progress: ProgressTracker;
  /** First input display name for output naming */
  primaryName: string;
};

export type PdfOperationHandler = (ctx: PdfOpContext) => Promise<ProcessResult>;

export type SplitMode = 'every-page' | 'ranges' | 'every-n' | 'groups';

export type PageFitMode = 'contain' | 'cover' | 'stretch';
export type PageSizeMode = 'a4' | 'letter' | 'fit-to-image' | 'original';
export type PageOrientation = 'portrait' | 'landscape' | 'auto';

export type CompressMode = 'structural' | 'advanced';
export type CompressPreset = 'fast' | 'balanced' | 'high';

export type AdvancedCompressSettings = {
  preset: CompressPreset;
  imageDpi: number;
  jpegQuality: number;
  colorImageDownsample: boolean;
  grayImageDownsample: boolean;
  compatibilityLevel: string;
  useObjectStreams: boolean;
  /** Ghostscript PDFSETTINGS */
  gsPdfSettings: '/screen' | '/ebook' | '/printer' | '/prepress';
};

export const ADVANCED_COMPRESS_PRESETS: Record<CompressPreset, AdvancedCompressSettings> = {
  fast: {
    preset: 'fast',
    imageDpi: 72,
    jpegQuality: 60,
    colorImageDownsample: true,
    grayImageDownsample: true,
    compatibilityLevel: '1.4',
    useObjectStreams: true,
    gsPdfSettings: '/screen',
  },
  balanced: {
    preset: 'balanced',
    imageDpi: 150,
    jpegQuality: 75,
    colorImageDownsample: true,
    grayImageDownsample: true,
    compatibilityLevel: '1.5',
    useObjectStreams: true,
    gsPdfSettings: '/ebook',
  },
  high: {
    preset: 'high',
    imageDpi: 300,
    jpegQuality: 90,
    colorImageDownsample: false,
    grayImageDownsample: false,
    compatibilityLevel: '1.7',
    useObjectStreams: true,
    gsPdfSettings: '/printer',
  },
};
