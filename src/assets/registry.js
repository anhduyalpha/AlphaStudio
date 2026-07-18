export const assetRoot = '/assets';

export const brandAssets = Object.freeze({
  mark: `${assetRoot}/brand/alphastudio-mark.svg`,
  markDark: `${assetRoot}/brand/alphastudio-mark-dark.svg`,
  markLight: `${assetRoot}/brand/alphastudio-mark-light.svg`,
  wordmark: `${assetRoot}/brand/alphastudio-wordmark.svg`,
  wordmarkLight: `${assetRoot}/brand/alphastudio-wordmark-light.svg`,
  horizontal: `${assetRoot}/brand/logo-horizontal.svg`,
  horizontalLight: `${assetRoot}/brand/logo-horizontal-light.svg`,
  monochrome: `${assetRoot}/brand/logo-monochrome.svg`,
  favicon: `${assetRoot}/brand/favicon.svg`,
  appIcon192: `${assetRoot}/brand/app-icon-192.png`,
  appIcon512: `${assetRoot}/brand/app-icon-512.png`,
  appIconMaskable: `${assetRoot}/brand/app-icon-maskable-512.png`,
});

export const toolIconNames = Object.freeze([
  'dashboard',
  'converter',
  'image',
  'pdf',
  'media',
  'audio',
  'archive',
  'qr',
  'text-ocr',
  'security',
  'developer',
  'color',
  'activity',
  'profile',
  'settings',
  'tools-manager',
]);

export const statusIconNames = Object.freeze([
  'uploading',
  'inspecting',
  'queued',
  'converting',
  'completed',
  'warning',
  'failed',
  'cancelled',
  'unavailable',
]);

export const toolIllustrations = Object.freeze(
  Object.fromEntries(
    ['converter', 'pdf', 'qr', 'image', 'media', 'archive', 'text', 'audio', 'color', 'security', 'developer']
      .map((name) => [name, `${assetRoot}/illustrations/tools/${name}.svg`]),
  ),
);

export const emptyIllustrations = Object.freeze({
  upload: `${assetRoot}/illustrations/empty/upload.svg`,
  converted: `${assetRoot}/illustrations/empty/converted.svg`,
  noResults: `${assetRoot}/illustrations/empty/no-results.svg`,
  toolsMissing: `${assetRoot}/illustrations/empty/tools-missing.svg`,
  conversionFailed: `${assetRoot}/illustrations/empty/conversion-failed.svg`,
  offline: `${assetRoot}/illustrations/empty/offline.svg`,
});

export const patternAssets = Object.freeze({
  dashboard: `${assetRoot}/patterns/studio-grid.svg`,
  onboarding: `${assetRoot}/patterns/onboarding-orbit.svg`,
});

export const iconSprite = `${assetRoot}/icons/alphastudio-icons.svg`;

export const emptyStateCopy = Object.freeze({
  upload: { title: 'Add files to begin', description: 'Drop files here or browse from your device.' },
  converted: { title: 'No converted files yet', description: 'Completed outputs stay here until you choose to download them.' },
  noResults: { title: 'No results found', description: 'Try another filter or clear the current search.' },
  toolsMissing: { title: 'External tool unavailable', description: 'Install the required local tool, then run the capability check again.' },
  conversionFailed: { title: 'Conversion failed', description: 'Review the error, adjust the input or settings, then retry.' },
  offline: { title: 'Backend connection lost', description: 'Start or reconnect the local AlphaStudio server to continue.' },
});
