const mediaHub = {
  id: 'media',
  name: 'Media Studio',
  icon: 'media',
  modes: [
    { id: 'video', name: 'Video' },
    { id: 'audio', name: 'Audio' },
    { id: 'image', name: 'Image' },
  ],
} as const;

export default mediaHub;
