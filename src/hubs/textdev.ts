const textDevHub = {
  id: 'text',
  name: 'Text & Dev',
  icon: 'developer',
  modes: [
    {
      id: 'text',
      name: 'Text',
      description: 'Clean, analyze, transform, or hash one local text file.',
      capabilityIds: ['text.cleanup', 'text.hash'],
      input: {
        kind: 'files',
        multiple: false,
        acceptFromJob: 'text',
      },
      options: [
        { id: 'operation', label: 'Text operation', type: 'select', options: [] },
      ],
      panels: [],
      run: {
        label: 'Run text job',
        job: { jobType: 'text', buildOptions: 'buildTextJobOptions' },
      },
      results: { kind: 'files' },
    },
    {
      id: 'editor',
      name: 'Editor',
      description: 'Edit, measure, export, and compare text without leaving the browser.',
      capabilityIds: [],
      input: {
        kind: 'text',
        label: 'Editor text',
        hint: 'Text stays in this browser until you explicitly export it.',
      },
      options: [],
      panels: ['compare', 'diff'],
      run: {
        label: 'Analyze & compare',
        local: { compute: 'computeTextEditor' },
      },
      results: { kind: 'json' },
    },
    {
      id: 'ocr',
      name: 'OCR',
      description: 'Capability-gated optical character recognition.',
      capabilityIds: ['text.ocr'],
      input: {
        kind: 'files',
        multiple: false,
        acceptFromJob: 'text',
      },
      options: [],
      panels: [],
      run: {
        label: 'Run OCR',
        job: { jobType: 'text', buildOptions: 'buildTextJobOptions' },
      },
      results: { kind: 'files' },
    },
    {
      id: 'dev',
      name: 'Developer tools',
      description: 'Eight existing server text utilities in one focused surface.',
      capabilityIds: [
        'text.format-json',
        'text.base64',
        'text.url',
        'text.hash',
        'text.cleanup',
      ],
      input: {
        kind: 'text',
        label: 'Utility input',
        hint: 'UUID Generator is the only utility that does not require input.',
      },
      options: [
        { id: 'operation', label: 'Developer utility', type: 'select', options: [] },
      ],
      panels: ['compare'],
      run: {
        label: 'Run utility',
        job: { jobType: 'text', buildOptions: 'buildTextJobOptions' },
      },
      results: { kind: 'files' },
    },
  ],
} as const;

export default textDevHub;
