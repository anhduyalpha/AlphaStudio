import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Profile, {
  normalizeProfile,
  profileChanged,
  profileInitials,
} from '../views/Profile.jsx';
import Settings, {
  normalizeSettings,
  settingsChanged,
} from '../views/Settings.jsx';

const APP_SOURCE = readFileSync(
  fileURLToPath(new URL('../App.jsx', import.meta.url)),
  'utf8',
);
const SETTINGS_SOURCE = readFileSync(
  fileURLToPath(new URL('../views/Settings.jsx', import.meta.url)),
  'utf8',
);
const PROFILE_SOURCE = readFileSync(
  fileURLToPath(new URL('../views/Profile.jsx', import.meta.url)),
  'utf8',
);
const MOTION_SOURCE = readFileSync(
  fileURLToPath(new URL('../hooks/useMotionPreference.js', import.meta.url)),
  'utf8',
);

describe('V3 Settings preference model', () => {
  it('normalizes server preferences and keeps the legacy animations bridge', () => {
    expect(normalizeSettings({
      theme: 'light',
      density: 'compact',
      motion: 'full',
      defaultQuality: 'max',
      openAfterExport: false,
      preserveMetadata: true,
    })).toEqual({
      theme: 'light',
      density: 'compact',
      motion: 'full',
      defaultQuality: 'max',
      openAfterExport: 'false',
      preserveMetadata: 'true',
    });
    expect(normalizeSettings({ animations: 'false' }).motion).toBe('reduced');
    expect(normalizeSettings({ density: 'invented' }).density).toBe('comfortable');
  });

  it('detects only persisted preference changes', () => {
    const baseline = normalizeSettings(null);
    expect(settingsChanged(baseline, baseline)).toBe(false);
    expect(settingsChanged({ ...baseline, density: 'compact' }, baseline)).toBe(true);
    expect(settingsChanged({ ...baseline, openAfterExport: 'false' }, baseline)).toBe(true);
  });

  it('keeps density server-only and limits browser mirrors to theme and motion', () => {
    expect(SETTINGS_SOURCE).toContain("api.getSettings()");
    expect(SETTINGS_SOURCE).toContain("api.saveSettings(payload)");
    expect(SETTINGS_SOURCE).toContain("density: ['comfortable', 'compact']");
    expect(SETTINGS_SOURCE).not.toContain('localStorage');
    expect(MOTION_SOURCE).toContain("const STORAGE_KEY = 'alpha-studio-motion'");
    expect(APP_SOURCE).toContain("localStorage.setItem('alpha-studio-theme', theme)");
    expect(APP_SOURCE).not.toMatch(/localStorage\.(?:setItem|getItem)\([^)]*density/i);
  });
});

describe('V3 Profile model', () => {
  it('normalizes all five profile fields and detects live changes', () => {
    const profile = normalizeProfile({
      displayName: 'Alpha D',
      studioName: 'AlphaStudio',
      role: 'Builder',
      locationLabel: 'Localhost',
      bio: null,
    });
    expect(profile).toEqual({
      displayName: 'Alpha D',
      studioName: 'AlphaStudio',
      role: 'Builder',
      locationLabel: 'Localhost',
      bio: '',
    });
    expect(profileChanged(profile, profile)).toBe(false);
    expect(profileChanged({ ...profile, bio: 'Local-first.' }, profile)).toBe(true);
    expect(profileInitials(profile)).toBe('AD');
    expect(profileInitials({ displayName: '', studioName: '' })).toBe('AS');
  });

  it('uses direct profile wrappers and renders a privacy-labelled preview', () => {
    expect(PROFILE_SOURCE).toContain('api.getProfile()');
    expect(PROFILE_SOURCE).toContain('api.saveProfile(form)');
    expect(PROFILE_SOURCE).toContain('aria-label="Profile preview"');
    expect(PROFILE_SOURCE).toContain('Stored only in local SQLite');
    expect(PROFILE_SOURCE).not.toMatch(/\b(fetch|XMLHttpRequest|EventSource)\s*\(/);
  });
});

describe('V3 route wiring and designed loading states', () => {
  it('mounts Settings and Profile through the next shell', () => {
    expect(APP_SOURCE).toContain("import Settings from './views/Settings.jsx'");
    expect(APP_SOURCE).toContain("import Profile from './views/Profile.jsx'");
    expect(APP_SOURCE).toContain("route.id === 'settings'");
    expect(APP_SOURCE).toContain("route.id === 'profile'");
    expect(APP_SOURCE).toContain('<Settings');
    expect(APP_SOURCE).toContain('<Profile />');
  });

  it('renders named loading states before direct API hydration', () => {
    expect(renderToStaticMarkup(<Settings />)).toContain('Loading Settings');
    expect(renderToStaticMarkup(<Profile />)).toContain('Loading Profile');
  });
});
