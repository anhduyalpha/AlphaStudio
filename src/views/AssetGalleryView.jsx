import React from 'react';
import Icon, { utilityIconNames } from '../components/Icon';
import { BrandLockup, BrandMark } from '../components/Brand';
import EmptyState from '../components/EmptyState';
import { PageIntro, PrimaryButton, SecondaryButton, StatusBadge, FeatureRail, Panel } from '../components/Common';
import { WorkbenchLayout, WorkspaceHeader, ProgressWave, Skeleton, CapabilityBanner } from '../components/Workbench';
import {
  brandAssets,
  emptyIllustrations,
  patternAssets,
  statusIconNames,
  toolIconNames,
  toolIllustrations,
} from '../assets/registry';

const titleFor = (name) => name.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function AssetGalleryView() {
  if (!import.meta.env.DEV) return null;

  return (
    <div className="view-stack asset-gallery">
      <WorkspaceHeader
        meta="Development / Design system"
        title="AlphaStudio asset gallery"
        description="Development-only surface for foundations, brand assets, workbench regions, and interaction states."
      />

      <section className="surface-card content-card asset-section">
        <div className="card-heading"><div><p className="eyebrow">Foundations</p><h3>Workbench primitives</h3></div><StatusBadge tone="cyan">Phase 2</StatusBadge></div>
        <WorkbenchLayout
          family="converter"
          stage={
            <Panel title="Stage">
              <Skeleton lines={4} />
              <ProgressWave value={42} label="Demo progress" />
            </Panel>
          }
          rail={
            <>
              <CapabilityBanner title="Capability sample" reason="Shown when a backend tool is offline." />
              <FeatureRail
                active="Resize"
                onChange={() => {}}
                items={[
                  { title: 'Resize', description: 'Scale assets', icon: 'image' },
                  { title: 'Compress', description: 'Reduce size', icon: 'archive' },
                ]}
              />
            </>
          }
          runbar={
            <>
              <StatusBadge tone="purple" status="converting">Running sample</StatusBadge>
              <div className="hero-button-row">
                <SecondaryButton size="sm">Cancel</SecondaryButton>
                <PrimaryButton size="sm" icon="arrow">Run</PrimaryButton>
              </div>
            </>
          }
        />
      </section>

      <section className="surface-card content-card asset-section">
        <div className="card-heading"><div><p className="eyebrow">Identity</p><h3>Brand lockups</h3></div><StatusBadge tone="purple">Studio Nodes</StatusBadge></div>
        <div className="brand-gallery-grid">
          <div className="brand-proof is-dark"><BrandLockup mode="dark" /></div>
          <div className="brand-proof is-light"><BrandLockup mode="light" /></div>
          <div className="brand-mark-proof"><BrandMark size={64} meaningful /><span>Adaptive mark</span></div>
          <div className="brand-mark-proof is-light"><img src={brandAssets.monochrome} alt="Monochrome AlphaStudio logo" width="300" height="64" /></div>
        </div>
        <div className="app-icon-grid">
          <figure><img src={brandAssets.appIcon192} alt="AlphaStudio 192 pixel app icon" width="96" height="96" /><figcaption>192 × 192</figcaption></figure>
          <figure><img src={brandAssets.appIcon512} alt="AlphaStudio 512 pixel app icon" width="96" height="96" /><figcaption>512 × 512</figcaption></figure>
          <figure className="maskable-proof"><img src={brandAssets.appIconMaskable} alt="AlphaStudio maskable app icon" width="96" height="96" /><figcaption>Maskable safe area</figcaption></figure>
        </div>
      </section>

      <section className="surface-card content-card asset-section">
        <div className="card-heading"><div><p className="eyebrow">Registry</p><h3>Workspace icons</h3></div><StatusBadge tone="cyan">24 × 24 grid</StatusBadge></div>
        <div className="asset-icon-grid">
          {toolIconNames.map((name) => (
            <div className="asset-icon-card" key={name}><Icon name={name} size={24} label={titleFor(name)} /><span>{titleFor(name)}</span></div>
          ))}
        </div>
        <div className="asset-size-proof" aria-label="Responsive icon size samples">
          {[16, 20, 24, 32, 40].map((size) => <span key={size}><Icon name="converter" size={size} label={`Converter icon at ${size} pixels`} /><small>{size}px</small></span>)}
        </div>
      </section>

      <section className="surface-card content-card asset-section">
        <div className="card-heading"><div><p className="eyebrow">Feedback</p><h3>Status icons</h3></div><StatusBadge status="completed" tone="green">Semantic states</StatusBadge></div>
        <div className="asset-icon-grid status-proof-grid">
          {statusIconNames.map((name) => (
            <div className={`asset-icon-card status-${name}`} key={name}><Icon name={name} size={24} label={titleFor(name)} /><span>{titleFor(name)}</span></div>
          ))}
        </div>
        <div className="asset-control-proof">
          <PrimaryButton icon="converter">Default</PrimaryButton>
          <SecondaryButton icon="image" className="is-hover-proof">Hover</SecondaryButton>
          <SecondaryButton icon="unavailable" disabled>Disabled</SecondaryButton>
        </div>
      </section>

      <section className="surface-card content-card asset-section">
        <div className="card-heading"><div><p className="eyebrow">Utilities</p><h3>Supporting icon set</h3></div><StatusBadge>{utilityIconNames.length} icons</StatusBadge></div>
        <div className="asset-icon-grid is-compact">
          {utilityIconNames.map((name) => (
            <div className="asset-icon-card" key={name}><Icon name={name} size={20} label={titleFor(name)} /><span>{titleFor(name)}</span></div>
          ))}
        </div>
      </section>

      <section className="surface-card content-card asset-section">
        <div className="card-heading"><div><p className="eyebrow">Workspaces</p><h3>Tool illustrations</h3></div><StatusBadge tone="blue">Responsive SVG</StatusBadge></div>
        <div className="asset-illustration-grid">
          {Object.entries(toolIllustrations).map(([name, src]) => (
            <figure key={name}><img src={src} alt={`${titleFor(name)} illustration`} width="640" height="400" loading="lazy" /><figcaption>{titleFor(name)}</figcaption></figure>
          ))}
        </div>
      </section>

      <section className="surface-card content-card asset-section">
        <div className="card-heading"><div><p className="eyebrow">Empty states</p><h3>Contextual feedback</h3></div><StatusBadge tone="purple">6 scenarios</StatusBadge></div>
        <div className="asset-empty-grid">
          {Object.keys(emptyIllustrations).map((type) => <EmptyState key={type} type={type} compact />)}
        </div>
      </section>

      <section className="surface-card content-card asset-section">
        <div className="card-heading"><div><p className="eyebrow">Surfaces</p><h3>Background patterns</h3></div></div>
        <div className="asset-pattern-grid">
          <figure style={{ backgroundImage: `url(${patternAssets.dashboard})` }}><figcaption>Dashboard grid</figcaption></figure>
          <figure style={{ backgroundImage: `url(${patternAssets.onboarding})` }}><figcaption>Onboarding orbit</figcaption></figure>
        </div>
      </section>
    </div>
  );
}
