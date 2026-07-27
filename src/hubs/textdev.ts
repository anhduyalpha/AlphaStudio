const textDevHub = {
  id: 'text',
  name: 'Text & Dev',
  icon: 'developer',
  modes: [
    { id: 'text', name: 'Text' },
    { id: 'editor', name: 'Editor' },
    { id: 'ocr', name: 'OCR' },
    { id: 'dev', name: 'Developer tools' },
  ],
} as const;

export default textDevHub;
