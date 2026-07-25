import React, { useEffect, useState } from 'react';
import { PrimaryButton, SelectField, ToggleRow } from '../components/Common';
import { WorkspaceHeader } from '../components/Workbench';
import { api } from '../api/client';
import useMotionPreference, { MOTION_MODES } from '../hooks/useMotionPreference';

export default function SettingsView({ notify }) {
  const { mode: motionMode, setMode: setMotionMode } = useMotionPreference();
  const [settings, setSettings] = useState({
    theme: 'system',
    density: 'comfortable',
    animations: 'true',
    defaultQuality: 'balanced',
    openAfterExport: 'true',
    preserveMetadata: 'true',
  });
  const [baseline, setBaseline] = useState(null);
  const [motionBaseline, setMotionBaseline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .getSettings()
      .then((data) => {
        const next = { theme: 'system', density: 'comfortable', animations: 'true', defaultQuality: 'balanced', openAfterExport: 'true', preserveMetadata: 'true', ...(data.settings || {}) };
        setSettings(next);
        setBaseline(next);
        setMotionBaseline(motionMode);
      })
      .catch((err) => {
        const msg = err.message || 'Failed to load settings';
        setError(msg);
        notify?.(msg);
      })
      .finally(() => setLoading(false));
    // motionMode intentionally read once at load for baseline; live changes via setMotionMode
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notify]);

  const applyTheme = (value) => {
    if (value === 'dark' || value === 'light') {
      document.documentElement.dataset.theme = value;
      try {
        localStorage.setItem('alpha-studio-theme', value);
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new CustomEvent('alpha-studio-theme', { detail: value }));
    }
  };

  const dirty = (baseline
    ? Object.keys(settings).some((k) => String(settings[k]) !== String(baseline[k]))
    : false) || (motionBaseline != null && motionMode !== motionBaseline);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      // Single Motion control owns data-motion; keep SQLite animations flag aligned.
      const payload = {
        ...settings,
        animations: motionMode === 'reduced' ? 'false' : 'true',
      };
      const data = await api.saveSettings(payload);
      const next = { ...payload, ...(data.settings || {}) };
      setSettings(next);
      setBaseline(next);
      setMotionBaseline(motionMode);
      applyTheme(next.theme);
      notify('Settings saved');
    } catch (err) {
      const msg = err.message || 'Save failed';
      setError(msg);
      notify(msg);
    } finally {
      setSaving(false);
    }
  };

  const bool = (key) => settings[key] === 'true' || settings[key] === true;
  const patch = (key, value) => setSettings((s) => ({ ...s, [key]: value }));

  const onMotionChange = (e) => {
    const next = e.target.value;
    if (!MOTION_MODES.includes(next)) return;
    setMotionMode(next);
    setSettings((s) => ({ ...s, animations: next === 'reduced' ? 'false' : 'true' }));
  };

  return (
    <div className="view-stack focused-settings-workspace" data-testid="focused-settings-workspace">
      <WorkspaceHeader
        meta="Manage / Settings"
        title="Studio preferences"
        description="Preferences persist in SQLite via the local API. Motion applies immediately to this browser."
        actions={
          <PrimaryButton icon="check" onClick={save} disabled={loading || saving || !dirty} busy={saving} data-testid="settings-save">
            {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
          </PrimaryButton>
        }
      />
      {error ? (
        <div className="surface-card content-card" data-testid="settings-error" role="alert">
          <p className="helper-note" style={{ margin: 0 }}>{error}</p>
        </div>
      ) : null}
      <section className="settings-grid" data-testid="settings-form">
        <article className="surface-card content-card settings-section">
          <div className="settings-title">
            <span>01</span>
            <div>
              <h3>Appearance</h3>
              <p>Control the overall visual experience.</p>
            </div>
          </div>
          <div className="form-grid">
            <SelectField
              label="Color theme"
              value={settings.theme}
              onChange={(e) => {
                const value = e.target.value;
                setSettings((s) => ({ ...s, theme: value }));
                applyTheme(value);
              }}
            >
              <option value="system">Use current theme toggle</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </SelectField>
            <SelectField
              label="Interface density"
              value={settings.density}
              onChange={(e) => patch('density', e.target.value)}
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </SelectField>
            <SelectField
              label="Motion"
              value={motionMode}
              onChange={onMotionChange}
            >
              <option value="full">Full</option>
              <option value="balanced">Balanced</option>
              <option value="reduced">Reduced</option>
            </SelectField>
          </div>
          <p className="settings-hint">
            OS “prefers reduced motion” always wins over the Motion setting. Density is saved for future layout support.
          </p>
        </article>

        <article className="surface-card content-card settings-section">
          <div className="settings-title">
            <span>02</span>
            <div>
              <h3>Exports</h3>
              <p>Default behavior for processing jobs.</p>
            </div>
          </div>
          <div className="form-grid">
            <SelectField
              label="Default quality"
              value={settings.defaultQuality}
              onChange={(e) => patch('defaultQuality', e.target.value)}
            >
              <option value="balanced">Balanced</option>
              <option value="max">Maximum quality</option>
              <option value="small">Smallest file</option>
            </SelectField>
          </div>
          <div className="toggle-stack">
            <ToggleRow
              title="Open after export"
              description="Trigger browser download when jobs complete."
              checked={bool('openAfterExport')}
              onChange={(e) => patch('openAfterExport', String(e.target.checked))}
            />
            <ToggleRow
              title="Preserve metadata"
              description="Keep supported metadata by default."
              checked={bool('preserveMetadata')}
              onChange={(e) => patch('preserveMetadata', String(e.target.checked))}
            />
          </div>
        </article>
      </section>
    </div>
  );
}
