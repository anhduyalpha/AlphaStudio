/**
 * Monotonic progress reporter with standardized PDF stages.
 * Never moves backward; never reports 100% until complete() is called
 * after output validation.
 */
export type PdfStage =
  | 'queued'
  | 'uploading'
  | 'validating'
  | 'inspecting'
  | 'preparing'
  | 'processing'
  | 'rendering'
  | 'ocr'
  | 'optimizing'
  | 'packaging'
  | 'validating-output'
  | 'completed';

export type ProgressFn = (progress: number, message?: string) => void;

/** Default stage weights (relative). Sum does not need to be 100. */
export const STAGE_WEIGHTS: Record<PdfStage, number> = {
  queued: 0,
  uploading: 5,
  validating: 8,
  inspecting: 6,
  preparing: 6,
  processing: 40,
  rendering: 35,
  ocr: 40,
  optimizing: 30,
  packaging: 10,
  'validating-output': 5,
  completed: 0,
};

const STAGE_ORDER: PdfStage[] = [
  'queued',
  'uploading',
  'validating',
  'inspecting',
  'preparing',
  'processing',
  'rendering',
  'ocr',
  'optimizing',
  'packaging',
  'validating-output',
  'completed',
];

export type ProgressTrackerOptions = {
  onProgress: ProgressFn;
  /** Stages this operation will use, in order */
  stages?: PdfStage[];
};

/**
 * Map a stage + fraction-within-stage (0..1) to a monotonic percent (0..99 until complete).
 */
export class ProgressTracker {
  private current = 0;
  private readonly onProgress: ProgressFn;
  private readonly stages: PdfStage[];
  private readonly ranges: { stage: PdfStage; start: number; end: number }[];

  constructor(opts: ProgressTrackerOptions) {
    this.onProgress = opts.onProgress;
    this.stages = opts.stages?.length
      ? opts.stages
      : (['validating', 'processing', 'packaging', 'validating-output', 'completed'] as PdfStage[]);
    this.ranges = buildRanges(this.stages);
  }

  /** Report absolute stage with optional fraction 0..1 inside the stage. Cap at 99 until complete(). */
  stage(stage: PdfStage, fraction = 0, message?: string): void {
    const range = this.ranges.find((r) => r.stage === stage);
    const msg = message || stageLabel(stage);
    if (!range) {
      // Unknown stage: nudge forward gently
      this.set(Math.min(99, this.current + 1), msg);
      return;
    }
    const f = clamp01(fraction);
    const pct = range.start + (range.end - range.start) * f;
    this.set(Math.min(99, pct), msg);
  }

  /** Batch progress: current/total within a stage. */
  batch(stage: PdfStage, current: number, total: number, message?: string): void {
    const t = Math.max(1, total);
    const c = Math.min(Math.max(0, current), t);
    const label = message || `${stageLabel(stage)} ${c}/${t}`;
    this.stage(stage, c / t, label);
  }

  /** Final 100% — only after output validation succeeded. */
  complete(message = 'completed'): void {
    this.set(100, message);
  }

  private set(pct: number, message: string): void {
    const next = Math.max(this.current, Math.min(100, Math.round(pct)));
    // Avoid replaying identical 100 spam; allow message updates on same pct below 100
    if (next < this.current) return;
    this.current = next;
    this.onProgress(this.current, message);
  }

  get value(): number {
    return this.current;
  }
}

function buildRanges(stages: PdfStage[]): { stage: PdfStage; start: number; end: number }[] {
  const usable = stages.filter((s) => s !== 'completed' && s !== 'queued');
  const weights = usable.map((s) => STAGE_WEIGHTS[s] || 10);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  // Reserve 0–2 for start, leave 99 max before complete
  let cursor = 2;
  const span = 97; // 2..99
  const ranges: { stage: PdfStage; start: number; end: number }[] = [];
  for (let i = 0; i < usable.length; i++) {
    const w = weights[i]! / sum;
    const start = cursor;
    const end = i === usable.length - 1 ? 99 : cursor + span * w;
    ranges.push({ stage: usable[i]!, start, end });
    cursor = end;
  }
  return ranges;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function stageLabel(stage: PdfStage): string {
  switch (stage) {
    case 'validating':
      return 'Validating inputs';
    case 'inspecting':
      return 'Inspecting document';
    case 'preparing':
      return 'Preparing';
    case 'processing':
      return 'Processing';
    case 'rendering':
      return 'Rendering pages';
    case 'ocr':
      return 'Running OCR';
    case 'optimizing':
      return 'Optimizing';
    case 'packaging':
      return 'Packaging output';
    case 'validating-output':
      return 'Validating output';
    case 'completed':
      return 'Completed';
    case 'uploading':
      return 'Uploading';
    case 'queued':
      return 'Queued';
    default:
      return stage;
  }
}

export { STAGE_ORDER };
