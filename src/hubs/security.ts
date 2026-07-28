const securityHub = {
  id: 'security',
  name: 'Security & Archive',
  icon: 'security',
  modes: [
    {
      id: 'security',
      name: 'Security',
      capabilityIds: [
        'security.hash',
        'security.metadata',
        'security.signature',
      ],
      input: {
        kind: 'files',
        multiple: false,
        acceptFromJob: 'security',
        selectable: true,
      },
      options: [
        {
          id: 'operation',
          type: 'select',
          label: 'Security operation',
          optionsFrom: 'security.operations',
        },
      ],
      run: {
        label: 'Run security check',
        job: {
          jobType: 'security',
          buildOptions: 'buildSecurityJobOptions',
        },
      },
      results: { kind: 'files', history: true },
    },
    {
      id: 'archive',
      name: 'Archive',
      capabilityIds: [
        'archive.zip',
        'archive.tar',
        'archive.gz',
        'archive.7z',
      ],
      input: {
        kind: 'files',
        multiple: true,
        acceptFromJob: 'archive',
        selectable: true,
      },
      options: [
        {
          id: 'operation',
          type: 'select',
          label: 'Archive operation',
          optionsFrom: 'archive.operations',
        },
      ],
      panels: ['archive-tree'],
      run: {
        label: 'Run archive job',
        job: {
          jobType: 'archive',
          buildOptions: 'buildArchiveJobOptions',
        },
      },
      results: { kind: 'files', history: true },
    },
  ],
} as const;

export default securityHub;
