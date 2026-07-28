/**
 * Format a byte count for compact, human-readable UI labels.
 * This is the single client-side implementation shared by every surface.
 */
export function formatBytes(value) {
  const bytes = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const rounded = size >= 10 ? Math.round(size) : Math.round(size * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}
