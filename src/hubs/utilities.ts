const utilitiesHub = {
  id: 'utilities',
  name: 'Utilities',
  icon: 'qr',
  modes: [
    {
      id: 'qr',
      name: 'QR',
      capabilityIds: ['qr.generate', 'qr.decode'],
      input: {
        kind: 'text',
      },
      options: [
        {
          id: 'operation',
          type: 'select',
          label: 'QR operation',
          optionsFrom: 'qr.operations',
        },
      ],
      panels: ['qr-designer'],
      run: {
        label: 'Generate QR',
        job: {
          jobType: 'qr',
          buildOptions: 'buildQrJobOptions',
        },
      },
      results: { kind: 'files', history: true },
    },
    {
      id: 'color',
      name: 'Color',
      capabilityIds: ['image.compress', 'image.strip-metadata'],
      input: {
        kind: 'none',
      },
      options: [
        {
          id: 'colorMode',
          type: 'select',
          label: 'Color workflow',
          optionsFrom: 'color.modes',
        },
      ],
      panels: ['color-lab'],
      run: {
        label: 'Save color result',
        local: {
          compute: 'computeColorLab',
        },
        job: {
          jobType: 'image',
          buildOptions: 'buildColorImageJobOptions',
        },
      },
      results: { kind: 'files', history: true },
    },
  ],
} as const;

export default utilitiesHub;
