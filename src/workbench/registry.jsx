import React, { lazy, Suspense, useMemo } from 'react';
import { ErrorState, Skeleton } from '../next/components/index.jsx';

export const panelPaths = Object.freeze({
  'pdf-organizer': './panels/PdfOrganizerPanel.jsx',
  'qr-designer': './panels/QrDesignerPanel.jsx',
  'color-lab': './panels/ColorLabPanel.jsx',
  waveform: './panels/WaveformPanel.jsx',
  timeline: './panels/TimelinePanel.jsx',
  'media-preview': './panels/MediaPreviewPanel.jsx',
  crop: './panels/CropPanel.jsx',
  diff: './panels/DiffPanel.jsx',
  'archive-tree': './panels/ArchiveTreePanel.jsx',
  compare: './panels/ComparePanel.jsx',
});

export const knownPanelKeys = Object.freeze(Object.keys(panelPaths));

const discoveredPanelModules = import.meta.glob('./panels/*.jsx');
const componentCache = new Map();

export function getPanelLoader(panelKey, modules = discoveredPanelModules) {
  const path = panelPaths[panelKey];
  return path ? modules[path] || null : null;
}

export function resolvePanel(panelKey, modules = discoveredPanelModules) {
  const loader = getPanelLoader(panelKey, modules);
  if (!loader) return null;
  if (modules === discoveredPanelModules && componentCache.has(panelKey)) {
    return componentCache.get(panelKey);
  }
  const Component = lazy(async () => {
    const loaded = await loader();
    if (!loaded?.default) {
      throw new Error(`Panel "${panelKey}" has no default export`);
    }
    return { default: loaded.default };
  });
  if (modules === discoveredPanelModules) componentCache.set(panelKey, Component);
  return Component;
}

export function validateHubReferences(hub, resolvers = {}) {
  const errors = [];
  const modes = Array.isArray(hub?.modes) ? hub.modes : [];
  const hasCapability = resolvers.hasCapability || (() => false);
  const hasAcceptList = resolvers.hasAcceptList || (() => false);
  const hasBuilder = resolvers.hasBuilder || (() => false);
  const hasCompute = resolvers.hasCompute || (() => false);
  const hasPanel = resolvers.hasPanel || ((key) => knownPanelKeys.includes(key));

  for (const mode of modes) {
    const prefix = `${hub?.id || 'hub'}:${mode?.id || 'mode'}`;
    for (const capabilityId of mode.capabilityIds || []) {
      if (!hasCapability(capabilityId)) errors.push(`${prefix} unknown capability "${capabilityId}"`);
    }
    if (mode.input?.acceptFrom && !hasAcceptList(mode.input.acceptFrom)) {
      errors.push(`${prefix} unknown accept list "${mode.input.acceptFrom}"`);
    }
    for (const panelKey of mode.panels || []) {
      if (!hasPanel(panelKey)) errors.push(`${prefix} unknown panel "${panelKey}"`);
    }
    if (mode.run?.job?.buildOptions && !hasBuilder(mode.run.job.buildOptions)) {
      errors.push(`${prefix} unknown options builder "${mode.run.job.buildOptions}"`);
    }
    if (mode.run?.local?.compute && !hasCompute(mode.run.local.compute)) {
      errors.push(`${prefix} unknown compute "${mode.run.local.compute}"`);
    }
  }
  return errors;
}

const noop = () => {};

export default function RegisteredPanel({
  panelKey,
  state,
  dispatch,
  onRecover = noop,
  fallback,
  ...props
}) {
  const Panel = useMemo(() => resolvePanel(panelKey), [panelKey]);
  if (!Panel) {
    return (
      <ErrorState
        className="workbench-panel-error"
        title={`Panel "${panelKey}" is unavailable`}
        message={`The registered panel key "${panelKey}" could not be resolved.`}
        actionLabel="Continue without panel"
        onAction={onRecover}
      />
    );
  }
  return (
    <Suspense fallback={fallback || <Skeleton variant="row" lines={4} label={`Loading ${panelKey} panel`} />}>
      <Panel state={state} dispatch={dispatch} {...props} />
    </Suspense>
  );
}
