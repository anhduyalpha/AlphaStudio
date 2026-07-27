const securityHub = {
  id: 'security',
  name: 'Security & Archive',
  icon: 'security',
  modes: [
    { id: 'security', name: 'Security' },
    { id: 'archive', name: 'Archive' },
  ],
} as const;

export default securityHub;
