import React, { useEffect, useState } from 'react';
import { PageIntro, PrimaryButton, SelectField, ToggleRow } from '../components/Common';
import { api } from '../api/client';

export default function SettingsView({ notify }) {
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

  const save = async () => {
    try {
      const data = await api.saveSettings(settings);
      setSettings((s) => ({ ...s, ...(data.settings || {}) }));
      notify('Settings saved');
    } catch (err) {
      notify(err.message || 'Save failed');
    }
  };

  const bool = (key) => settings[key] === 'true' || settings[key] === true;

  return (
    <div className="view-stack">
      <PageIntro
        eyebrow="Manage / Settings"
        title="Personalize your local studio."
        description="Preferences persist in SQLite via the local API."
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
              onChange={(e) => setSettings((s) => ({ ...s, theme: e.target.value }))}
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
          </div>
          <div className="toggle-stack">
            <ToggleRow
              title="Subtle animations"
              description="Enable motion when the system allows it."
              checked={bool('animations')}
              onChange={(e) => setSettings((s) => ({ ...s, animations: String(e.target.checked) }))}
            />
          </div>
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
