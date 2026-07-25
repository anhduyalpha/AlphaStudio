import React, { useEffect, useState } from 'react';
import { PageIntro, PrimaryButton, SelectField, ToggleRow } from '../components/Common';
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getSettings()
      .then((data) => setSettings((s) => ({ ...s, ...(data.settings || {}) })))
      .catch((err) => notify?.(err.message || 'Failed to load settings'))
      .finally(() => setLoading(false));
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

  const save = async () => {
    try {
      // Keep SQLite animations flag aligned with real motion preference for API consumers.
      const payload = {
        ...settings,
        animations: motionMode === 'reduced' ? 'false' : 'true',
      };
      const data = await api.saveSettings(payload);
      setSettings((s) => ({ ...s, ...(data.settings || {}) }));
      applyTheme(payload.theme);
      notify('Settings saved');
    } catch (err) {
      notify(err.message || 'Save failed');
    }
  };

  const bool = (key) => settings[key] === 'true' || settings[key] === true;

  const onMotionChange = (e) => {
    const next = e.target.value;
    if (!MOTION_MODES.includes(next)) return;
    setMotionMode(next);
    setSettings((s) => ({ ...s, animations: next === 'reduced' ? 'false' : 'true' }));
  };

  return (
    <div className="view-stack">
      <PageIntro
        eyebrow="Manage / Settings"
        title="Personalize your local studio."
        description="Preferences persist in SQLite via the local API. Motion applies immediately to this browser."
        actions={
          <PrimaryButton icon="check" onClick={save} disabled={loading}>
            Save changes
          </PrimaryButton>
        }
      />
      <section className="settings-grid">
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
              onChange={(e) => setSettings((s) => ({ ...s, density: e.target.value }))}
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
              onChange={(e) => setSettings((s) => ({ ...s, defaultQuality: e.target.value }))}
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
              onChange={(e) => setSettings((s) => ({ ...s, openAfterExport: String(e.target.checked) }))}
            />
            <ToggleRow
              title="Preserve metadata"
              description="Keep supported metadata by default."
              checked={bool('preserveMetadata')}
              onChange={(e) => setSettings((s) => ({ ...s, preserveMetadata: String(e.target.checked) }))}
            />
          </div>
        </article>
      </section>
    </div>
  );
}
