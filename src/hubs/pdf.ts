const pdfHub = {
  id: 'pdf',
  name: 'PDF',
  icon: 'pdf',
  modes: [
    { id: 'operations', name: 'Operations' },
    { id: 'organize', name: 'Organize' },
    { id: 'export', name: 'Export' },
  ],
} as const;

export default pdfHub;
