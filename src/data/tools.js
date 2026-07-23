import { toolIllustrations } from '../assets/registry';

export const navigation = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', group: 'Studio' },
  { id: 'converter', label: 'All-in-One Converter', icon: 'converter', group: 'Core tools' },
  { id: 'pdf', label: 'PDF Studio', icon: 'pdf', group: 'Core tools' },
  { id: 'qr', label: 'QR Lab', icon: 'qr', group: 'Core tools' },
  { id: 'image', label: 'Image Lab', icon: 'image', group: 'Core tools' },
  { id: 'media', label: 'Media Toolkit', icon: 'media', group: 'Core tools' },
  { id: 'archive', label: 'Archive Center', icon: 'archive', group: 'More tools' },
  { id: 'text', label: 'Text & OCR', icon: 'text-ocr', group: 'More tools' },
  { id: 'audio', label: 'Audio Lab', icon: 'audio', group: 'More tools' },
  { id: 'color', label: 'Color Studio', icon: 'color', group: 'More tools' },
  { id: 'security', label: 'Security Lab', icon: 'security', group: 'More tools' },
  { id: 'developer', label: 'Developer Utilities', icon: 'developer', group: 'More tools' },
  { id: 'activity', label: 'Activity', icon: 'activity', group: 'Manage' },
  { id: 'profile', label: 'Profile Studio', icon: 'profile', group: 'Manage' },
  { id: 'settings', label: 'Settings', icon: 'settings', group: 'Manage' },
];

export const toolCards = [
  {
    id: 'converter',
    name: 'All-in-One Converter',
    icon: 'converter',
    color: 'purple',
    description: 'Documents, images, media, spreadsheets and archives in one batch workspace.',
    badge: '24+ formats',
    art: toolIllustrations.converter,
  },
  {
    id: 'pdf',
    name: 'PDF Studio',
    icon: 'pdf',
    color: 'cyan',
    description: 'Merge, split, structurally optimize, reorder, rotate, extract pages, and build PDFs from images.',
    badge: 'Core PDF ops',
    art: toolIllustrations.pdf,
  },
  {
    id: 'qr',
    name: 'QR Encode / Decode',
    icon: 'qr',
    color: 'blue',
    description: 'Create QR codes and decode images with a focused dual-panel workflow.',
    badge: 'Instant UI',
    art: toolIllustrations.qr,
  },
  {
    id: 'image',
    name: 'Image Lab',
    icon: 'image',
    color: 'green',
    description: 'Resize, compress, convert, crop, watermark and rename visual assets.',
    badge: 'Batch ready',
    art: toolIllustrations.image,
  },
  {
    id: 'media',
    name: 'Media Toolkit',
    icon: 'media',
    color: 'pink',
    description: 'Trim clips, extract audio and prepare local media export presets.',
    badge: 'Timeline UI',
    art: toolIllustrations.media,
  },
  {
    id: 'archive',
    name: 'Archive Center',
    icon: 'archive',
    color: 'purple',
    description: 'Compress, extract, inspect, split, password-protect and verify archives.',
    badge: 'ZIP • 7Z • TAR',
    art: toolIllustrations.archive,
  },
  {
    id: 'text',
    name: 'Text & OCR',
    icon: 'text-ocr',
    color: 'cyan',
    description: 'Extract text from images, compare text, clean formatting and count words.',
    badge: '8 utilities',
    art: toolIllustrations.text,
  },
  {
    id: 'audio',
    name: 'Audio Lab',
    icon: 'audio',
    color: 'pink',
    description: 'Trim, normalize, remove silence, convert and prepare audio exports.',
    badge: 'Waveform UI',
    art: toolIllustrations.audio,
  },
  {
    id: 'color',
    name: 'Color Studio',
    icon: 'color',
    color: 'amber',
    description: 'Build palettes, inspect contrast, convert color formats and design gradients.',
    badge: 'Design tools',
    art: toolIllustrations.color,
  },
  {
    id: 'security',
    name: 'Security Lab',
    icon: 'security',
    color: 'green',
    description: 'Generate hashes, inspect metadata, compare checksums and create passwords.',
    badge: 'Local concept',
    art: toolIllustrations.security,
  },
  {
    id: 'developer',
    name: 'Developer Utilities',
    icon: 'developer',
    color: 'amber',
    description: 'JSON, Base64, URL encoding, hashing and text cleanup utilities.',
    badge: '8 utilities',
    art: toolIllustrations.developer,
  },
];

export const quickActions = [
  { label: 'Convert files', icon: 'swap', route: 'converter' },
  { label: 'Merge PDF', icon: 'layers', route: 'pdf' },
  { label: 'Compress PDF', icon: 'minimize', route: 'pdf' },
  { label: 'Create QR', icon: 'qr', route: 'qr' },
  { label: 'Decode QR', icon: 'scan', route: 'qr' },
  { label: 'Resize images', icon: 'image', route: 'image' },
  { label: 'Extract audio', icon: 'audio', route: 'media' },
  { label: 'Open archive', icon: 'archive', route: 'archive' },
  { label: 'OCR image', icon: 'text', route: 'text' },
  { label: 'Build palette', icon: 'palette', route: 'color' },
  { label: 'Generate hash', icon: 'shield', route: 'security' },
  { label: 'Format JSON', icon: 'code', route: 'developer' },
];

/** @deprecated Demo fixture - do not render in live views; use /api/jobs */
export const recentJobs = [];

export const fileRows = [
  { name: 'design-system.pdf', size: '8.7 MB', type: 'PDF document', state: 'Ready' },
  { name: 'hero-visual.png', size: '4.2 MB', type: 'PNG image', state: 'Ready' },
  { name: 'launch-notes.docx', size: '890 KB', type: 'Word document', state: 'Queued' },
];

/** Implemented PDF Studio modules only - gated features stay out of marketing lists */
export const pdfModules = [
  { label: 'Merge PDF', icon: 'layers', color: 'purple', capability: 'pdf.merge' },
  { label: 'Split PDF', icon: 'scissors', color: 'cyan', capability: 'pdf.split' },
  { label: 'Structural optimize', icon: 'minimize', color: 'blue', capability: 'pdf.compress' },
  { label: 'Reorder Pages', icon: 'sort', color: 'green', capability: 'pdf.reorder' },
  { label: 'Rotate Pages', icon: 'refresh', color: 'cyan', capability: 'pdf.rotate' },
  { label: 'Extract pages', icon: 'file', color: 'purple', capability: 'pdf.extract' },
  { label: 'Images to PDF', icon: 'image', color: 'amber', capability: 'pdf.from-images' },
];

/** @deprecated Demo fixture - do not render in live views; use /api/activity */
export const activityRows = [];
