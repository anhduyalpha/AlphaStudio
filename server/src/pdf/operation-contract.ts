/**
 * Authoritative public contract for PDF operations.
 *
 * Operation ids are the exact values accepted in `options.operation`. The
 * capability id links each operation to the machine-specific availability
 * reported in `/api/capabilities.tools`.
 */
export type PdfInputCardinality = {
  minFiles: number;
  /** `null` means the operation has no fixed upper bound. */
  maxFiles: number | null;
};

export type PdfEnginePolicy = {
  strategy: 'bundled' | 'required-external' | 'preferred-external' | 'hybrid';
  engines: readonly string[];
  fallback: 'none' | 'next-available' | 'bundled';
};

export type PdfOutputKind = 'pdf' | 'zip' | 'png' | 'jpeg' | 'text' | 'json';

export type PdfOperationDescriptor = {
  id: string;
  capability: string;
  cardinality: PdfInputCardinality;
  options: readonly string[];
  outputKinds: readonly PdfOutputKind[];
  enginePolicy: PdfEnginePolicy;
};

const onePdf: PdfInputCardinality = { minFiles: 1, maxFiles: 1 };
export const PDF_MAX_INPUT_FILES = 20;
const bundledPdfLib: PdfEnginePolicy = {
  strategy: 'bundled',
  engines: ['pdf-lib'],
  fallback: 'none',
};

export const PDF_OPERATION_DESCRIPTORS: readonly PdfOperationDescriptor[] = [
  {
    id: 'merge',
    capability: 'pdf.merge',
    cardinality: { minFiles: 2, maxFiles: PDF_MAX_INPUT_FILES },
    options: [],
    outputKinds: ['pdf'],
    enginePolicy: bundledPdfLib,
  },
  {
    id: 'split',
    capability: 'pdf.split',
    cardinality: onePdf,
    options: ['splitMode', 'pages', 'everyN', 'groups'],
    outputKinds: ['pdf', 'zip'],
    enginePolicy: bundledPdfLib,
  },
  {
    id: 'rotate',
    capability: 'pdf.rotate',
    cardinality: onePdf,
    options: ['pages', 'angle'],
    outputKinds: ['pdf'],
    enginePolicy: bundledPdfLib,
  },
  {
    id: 'reorder',
    capability: 'pdf.reorder',
    cardinality: onePdf,
    options: ['order', 'allowDuplicates'],
    outputKinds: ['pdf'],
    enginePolicy: bundledPdfLib,
  },
  {
    id: 'extract',
    capability: 'pdf.extract',
    cardinality: onePdf,
    options: ['pages'],
    outputKinds: ['pdf'],
    enginePolicy: bundledPdfLib,
  },
  {
    id: 'delete-pages',
    capability: 'pdf.delete-pages',
    cardinality: onePdf,
    options: ['pages'],
    outputKinds: ['pdf'],
    enginePolicy: bundledPdfLib,
  },
  {
    id: 'duplicate-pages',
    capability: 'pdf.duplicate-pages',
    cardinality: onePdf,
    options: ['pages', 'insertAt'],
    outputKinds: ['pdf'],
    enginePolicy: bundledPdfLib,
  },
  {
    id: 'compress-structural',
    capability: 'pdf.compress.structural',
    cardinality: onePdf,
    options: ['quality'],
    outputKinds: ['pdf'],
    enginePolicy: bundledPdfLib,
  },
  {
    id: 'compress-advanced',
    capability: 'pdf.compress.advanced',
    cardinality: onePdf,
    options: ['quality'],
    outputKinds: ['pdf'],
    enginePolicy: {
      strategy: 'required-external',
      engines: ['ghostscript'],
      fallback: 'none',
    },
  },
  {
    id: 'to-images',
    capability: 'pdf.to-images',
    cardinality: onePdf,
    options: ['pages', 'format', 'dpi', 'quality'],
    outputKinds: ['png', 'jpeg', 'zip'],
    enginePolicy: {
      strategy: 'preferred-external',
      engines: ['pdftoppm', 'mutool', 'ghostscript'],
      fallback: 'next-available',
    },
  },
  {
    id: 'from-images',
    capability: 'pdf.from-images',
    cardinality: { minFiles: 1, maxFiles: PDF_MAX_INPUT_FILES },
    options: ['pageSize', 'orientation', 'fit', 'marginPt'],
    outputKinds: ['pdf'],
    enginePolicy: {
      strategy: 'bundled',
      engines: ['pdf-lib', 'sharp'],
      fallback: 'none',
    },
  },
  {
    id: 'to-text',
    capability: 'pdf.to-text',
    cardinality: onePdf,
    options: [],
    outputKinds: ['text'],
    enginePolicy: {
      strategy: 'hybrid',
      engines: ['pdftotext', 'mutool', 'native'],
      fallback: 'next-available',
    },
  },
  {
    id: 'ocr',
    capability: 'pdf.ocr',
    cardinality: onePdf,
    options: ['pages', 'ocrLang', 'ocrPageLimit'],
    outputKinds: ['text'],
    enginePolicy: {
      strategy: 'required-external',
      engines: ['tesseract', 'pdf-rasterizer'],
      fallback: 'none',
    },
  },
  {
    id: 'inspect',
    capability: 'pdf.inspect',
    cardinality: onePdf,
    options: [],
    outputKinds: ['json'],
    enginePolicy: bundledPdfLib,
  },
  {
    id: 'repair',
    capability: 'pdf.repair',
    cardinality: onePdf,
    options: [],
    outputKinds: ['pdf'],
    enginePolicy: {
      strategy: 'preferred-external',
      engines: ['qpdf', 'ghostscript'],
      fallback: 'next-available',
    },
  },
] as const;
