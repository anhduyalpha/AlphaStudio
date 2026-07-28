const mediaHub = {
  id: 'media',
  name: 'Media Studio',
  icon: 'media',
  modes: [
    {
      id: 'video',
      name: 'Video',
      input: {
        kind: 'files',
        multiple: false,
        acceptFromJob: 'media',
        selectable: true,
      },
      options: [
        {
          id: 'operation',
          type: 'select',
          label: 'Video operation',
          optionsFrom: 'media.video.operations',
        },
      ],
      panels: ['media-preview'],
      run: {
        label: 'Run video job',
        job: {
          jobType: 'media',
          buildOptions: 'buildMediaJobOptions',
        },
      },
      results: { kind: 'files', history: true },
    },
    {
      id: 'audio',
      name: 'Audio',
      input: {
        kind: 'files',
        multiple: false,
        acceptFromJob: 'audio',
        selectable: true,
      },
      options: [
        {
          id: 'operation',
          type: 'select',
          label: 'Audio operation',
          optionsFrom: 'media.audio.operations',
        },
      ],
      panels: ['media-preview'],
      run: {
        label: 'Run audio job',
        job: {
          jobType: 'audio',
          buildOptions: 'buildMediaJobOptions',
        },
      },
      results: { kind: 'files', history: true },
    },
    {
      id: 'image',
      name: 'Image',
      input: {
        kind: 'files',
        multiple: false,
        acceptFromJob: 'image',
        selectable: true,
      },
      options: [
        {
          id: 'operation',
          type: 'select',
          label: 'Image operation',
          optionsFrom: 'media.image.operations',
        },
      ],
      panels: ['media-preview', 'crop'],
      run: {
        label: 'Process image',
        job: {
          jobType: 'image',
          buildOptions: 'buildMediaJobOptions',
        },
      },
      results: { kind: 'files', history: true },
    },
  ],
} as const;

export default mediaHub;
