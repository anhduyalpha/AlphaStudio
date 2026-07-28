import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import useMotionPreference, { MOTION_MODES } from '../../hooks/useMotionPreference.js';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Icon,
  Skeleton,
  StatusBadge,
  Toggle,
} from '../components/index.jsx';

export const SETTINGS_DEFAULTS = Object.freeze({
  theme: 'system',
  density: 'comfortable',
  motion: 'balanced',
  defaultQuality: 'balanced',
  openAfterExport: 'true',
  preserveMetadata: 'true',
});

export function normalizeSettings(value, fallbackMotion = 'balanced') {
  const source = value && typeof value === 'object' ? value : {};
  const motion = MOTION_MODES.includes(source.motion)
    ? source.motion
    : source.animations === 'false'
      ? 'reduced'
      : MOTION_MODES.includes(fallbackMotion)
        ? fallbackMotion
        : SETTINGS_DEFAULTS.motion;
  return {
    theme: ['system', 'dark', 'light'].includes(source.theme)
      ? source.theme
      : SETTINGS_DEFAULTS.theme,
    density: ['comfortable', 'compact'].includes(source.density)
      ? source.density
      : SETTINGS_DEFAULTS.density,
    motion,
    defaultQuality: ['balanced', 'max', 'small'].includes(source.defaultQuality)
      ? source.defaultQuality
      : SETTINGS_DEFAULTS.defaultQuality,
    openAfterExport: String(source.openAfterExport ?? SETTINGS_DEFAULTS.openAfterExport),
    preserveMetadata: String(source.preserveMetadata ?? SETTINGS_DEFAULTS.preserveMetadata),
  };
}

export function settingsChanged(settings, baseline) {
  if (!baseline) return false;
  return Object.keys(SETTINGS_DEFAULTS).some(
    (key) => String(settings?.[key] ?? '') !== String(baseline?.[key] ?? ''),
  );
}

function enabled(value) {
  return value === true || value === 'true';
}

export default function Settings({ theme = 'dark', onThemeChange }) {
  const { mode: motionMode, setMode: setMotionMode } = useMotionPreference();
  const [settings, setSettings] = useState(() => normalizeSettings(null, motionMode));
  const [baseline, setBaseline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dirty = useMemo(() => settingsChanged(settings, baseline), [baseline, settings]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api.getSettings()
      .then((payload) => {
        if (!active) return;
        const next = normalizeSettings(payload?.settings, motionMode);
        setSettings(next);
        setBaseline(next);
        setMotionMode(next.motion);
        if (next.theme === 'dark' || next.theme === 'light') onThemeChange?.(next.theme);
      })
      .catch((loadError) => {
        if (active) setError(loadError?.message || 'Could not load studio preferences.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // Initial hydration reconciles the server truth with the pre-paint mirrors once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = (key, value) => {
    setNotice('');
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const chooseTheme = (value) => {
    patch('theme', value);
    if (value === 'dark' || value === 'light') onThemeChange?.(value);
  };

  const chooseMotion = (value) => {
    if (!MOTION_MODES.includes(value)) return;
    patch('motion', value);
    setMotionMode(value);
  };

  const reset = () => {
    if (!baseline) return;
    setSettings(baseline);
    setMotionMode(baseline.motion);
    if (baseline.theme === 'dark' || baseline.theme === 'light') {
      onThemeChange?.(baseline.theme);
    }
    setNotice('Unsaved changes reset.');
    setError('');
  };

  const save = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = {
        ...settings,
        animations: settings.motion === 'reduced' ? 'false' : 'true',
      };
      const response = await api.saveSettings(payload);
      const next = normalizeSettings(response?.settings, settings.motion);
      setSettings(next);
      setBaseline(next);
      setMotionMode(next.motion);
      if (next.theme === 'dark' || next.theme === 'light') onThemeChange?.(next.theme);
      setNotice('Studio preferences saved.');
    } catch (saveError) {
      setError(saveError?.message || 'Could not save studio preferences.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="settings-view" aria-label="Loading Settings">
        <Skeleton variant="row" lines={7} label="Loading Settings" />
      </div>
    );
  }

  return (
    <div className="settings-view">
      <section className="settings-hero" aria-labelledby="settings-title">
        <div>
          <p className="view-eyebrow">Local preferences</p>
          <h2 id="settings-title">Studio settings</h2>
          <p>Appearance and export defaults persist in SQLite; theme and motion mirrors apply before paint.</p>
        </div>
        <div className="settings-hero__actions">
          <Button variant="ghost" disabled={!dirty || saving} onClick={reset}>Reset changes</Button>
          <Button variant="primary" icon="check" busy={saving} disabled={!dirty} onClick={save}>
            {dirty ? 'Save changes' : 'Saved'}
          </Button>
        </div>
      </section>

      {notice ? <p className="settings-notice" role="status">{notice}</p> : null}
      {error ? (
        <ErrorState
          title="Settings need attention"
          message={error}
          actionLabel={dirty ? 'Try saving again' : 'Reload settings'}
          onAction={dirty ? save : () => window.location.reload()}
          actionDisabled={saving}
        />
      ) : null}

      <div className="settings-grid">
        <Card
          className="settings-card"
          title="Appearance"
          subtitle="Immediate browser mirrors"
          actions={<StatusBadge tone="neutral">{theme} theme</StatusBadge>}
        >
          <div className="settings-fields">
            <Field
              label="Color theme"
              hint="System keeps the current shell toggle; Dark and Light update it immediately."
              variant="select"
              value={settings.theme}
              options={[
                { value: 'system', label: `Use current (${theme})` },
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
              ]}
              onChange={(event) => chooseTheme(event.currentTarget.value)}
            />
            <Field
              label="Interface density"
              hint="Saved for future layout semantics; it intentionally has no visual effect yet."
              variant="select"
              value={settings.density}
              options={[
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'compact', label: 'Compact (saved only)' },
              ]}
              onChange={(event) => patch('density', event.currentTarget.value)}
            />
            <Field
              label="Motion"
              hint="OS reduced-motion always overrides this preference."
              variant="select"
              value={settings.motion}
              options={[
                { value: 'full', label: 'Full' },
                { value: 'balanced', label: 'Balanced' },
                { value: 'reduced', label: 'Reduced' },
              ]}
              onChange={(event) => chooseMotion(event.currentTarget.value)}
            />
          </div>
          <div className="settings-decision-note">
            <Icon name="layers" />
            <div>
              <strong>Density is server-persisted and deliberately inert.</strong>
              <span>Spacing-scale semantics remain an explicit product decision, so no private client key is created.</span>
            </div>
          </div>
        </Card>

        <Card className="settings-card" title="Exports" subtitle="Defaults for new processing jobs">
          <div className="settings-fields">
            <Field
              label="Default quality"
              variant="select"
              value={settings.defaultQuality}
              options={[
                { value: 'balanced', label: 'Balanced' },
                { value: 'max', label: 'Maximum quality' },
                { value: 'small', label: 'Smallest file' },
              ]}
              onChange={(event) => patch('defaultQuality', event.currentTarget.value)}
            />
            <div className="settings-toggles">
              <Toggle
                label="Open after export"
                description="Trigger the browser download when a completed output is requested."
                checked={enabled(settings.openAfterExport)}
                onChange={(value) => patch('openAfterExport', String(value))}
              />
              <Toggle
                label="Preserve metadata"
                description="Keep supported source metadata by default."
                checked={enabled(settings.preserveMetadata)}
                onChange={(value) => patch('preserveMetadata', String(value))}
              />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
