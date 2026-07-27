const convertHub = {
  id: 'convert',
  name: 'Convert',
  icon: 'converter',
  modes: [
    {
      id: 'convert',
      name: 'Batch conversion',
      capabilityIds: ['converter.batch'],
      input: {
        kind: 'files',
        multiple: true,
      },
      options: [
        {
          id: 'format',
          type: 'derived',
          label: 'Output format',
          value: 'Recommended per detected group',
          hint: 'Targets come from live server detection for every input group.',
        },
        {
          id: 'quality',
          type: 'select',
          label: 'Quality',
          optionsFrom: 'quality.presets',
          hint: 'Only presets published by the server are offered.',
        },
        {
          id: 'preserveMetadata',
          type: 'toggle',
          label: 'Preserve metadata',
          hint: 'Applied only when the selected conversion engine supports it.',
          default: true,
        },
      ],
      run: {
        job: {
          jobType: 'converter',
          buildOptions: 'buildConvertJobOptions',
        },
      },
      results: {
        kind: 'files',
      },
    },
  ],
} as const;

export default convertHub;
