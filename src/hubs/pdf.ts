const pdfHub = {
  id: 'pdf',
  name: 'PDF',
  icon: 'pdf',
  modes: [
    {
      id: 'operations',
      name: 'Operations',
      input: {
        kind: 'files',
        multiple: true,
        acceptFromJob: 'pdf',
        selectable: true,
        reorderable: true,
      },
      options: [
        {
          id: 'operation',
          type: 'select',
          label: 'Operation',
          optionsFrom: 'pdf.operations',
          hint: 'Availability, file limits, options, and engines come from the server.',
        },
      ],
      run: {
        label: 'Run PDF operation',
        job: {
          jobType: 'pdf',
          buildOptions: 'buildPdfJobOptions',
        },
      },
      results: {
        kind: 'files',
        history: true,
      },
    },
    {
      id: 'organize',
      name: 'Organize',
      input: {
        kind: 'files',
        multiple: false,
        acceptFromJob: 'pdf',
        selectable: true,
      },
      panels: ['pdf-organizer'],
      run: {
        label: 'Apply page plan',
        job: {
          jobType: 'pdf',
          buildOptions: 'buildPdfJobOptions',
        },
      },
      results: {
        kind: 'files',
        history: true,
      },
    },
    {
      id: 'export',
      name: 'Export',
      input: {
        kind: 'none',
      },
      options: [
        {
          id: 'exportScope',
          type: 'derived',
          label: 'Export scope',
          value: 'Completed PDF outputs in this workspace',
          hint: 'Use the Results rail to download one output or choose a subset.',
        },
      ],
      run: {
        label: 'Download all PDF outputs',
        action: 'downloadPdfOutputs',
      },
      results: {
        kind: 'files',
        history: true,
      },
    },
  ],
} as const;

export default pdfHub;
