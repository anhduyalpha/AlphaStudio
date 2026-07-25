import React, { useEffect, useState } from 'react';
import { PrimaryButton, SecondaryButton, TextField } from '../components/Common';
import { WorkspaceHeader } from '../components/Workbench';
import { api } from '../api/client';

export default function ProfileView({ notify }) {
  const [form, setForm] = useState({
    displayName: '',
    studioName: '',
    role: '',
    locationLabel: '',
    bio: '',
  });
  const [baseline, setBaseline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .getProfile()
      .then((p) => {
        const next = {
          displayName: p.displayName || '',
          studioName: p.studioName || '',
          role: p.role || '',
          locationLabel: p.locationLabel || '',
          bio: p.bio || '',
        };
        setForm(next);
        setBaseline(next);
      })
      .catch((err) => {
        const msg = err.message || 'Failed to load profile';
        setError(msg);
        notify?.(msg);
      })
      .finally(() => setLoading(false));
  }, [notify]);

  const dirty = baseline
    ? Object.keys(form).some((k) => String(form[k] || '') !== String(baseline[k] || ''))
    : false;

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const p = await api.saveProfile(form);
      const next = {
        displayName: p.displayName,
        studioName: p.studioName,
        role: p.role,
        locationLabel: p.locationLabel,
        bio: p.bio,
      };
      setForm(next);
      setBaseline(next);
      notify('Profile saved');
    } catch (err) {
      const msg = err.message || 'Save failed';
      setError(msg);
      notify(msg);
    } finally {
      setSaving(false);
    }
  };

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="view-stack profile-workspace family-neutral" data-testid="profile-workspace">
      <WorkspaceHeader
        meta="Manage / Profile Studio"
        title="Local studio identity"
        description="Profile fields persist in SQLite and reload after restart."
        actions={
          <>
            <SecondaryButton icon="download" onClick={() => notify('Use the avatar SVG in /avatars for export.')}>
              Export SVG
            </SecondaryButton>
            <PrimaryButton icon="check" onClick={save} disabled={loading || saving || !dirty} busy={saving} data-testid="profile-save">
              {saving ? 'Saving…' : dirty ? 'Save profile' : 'Saved'}
            </PrimaryButton>
          </>
        }
      />
      {error ? (
        <div className="surface-card content-card" data-testid="profile-error" role="alert">
          <p className="helper-note" style={{ margin: 0 }}>{error}</p>
        </div>
      ) : null}
      <section className="profile-layout" style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1.4fr) minmax(240px, 0.8fr)' }} data-testid="profile-form">
        <article className="surface-card content-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Identity</p>
              <h3>Studio profile</h3>
            </div>
          </div>
          <div className="form-grid">
            <TextField label="Display name" value={form.displayName} onChange={set('displayName')} placeholder="AlphaD" />
            <TextField label="Studio name" value={form.studioName} onChange={set('studioName')} placeholder="AlphaStudio" />
            <TextField label="Role" value={form.role} onChange={set('role')} placeholder="Product builder" />
            <TextField label="Location label" value={form.locationLabel} onChange={set('locationLabel')} placeholder="Localhost" />
          </div>
          <label className="field-group" style={{ marginTop: 12, display: 'block' }}>
            <span className="field-label">Bio</span>
            <textarea value={form.bio} onChange={set('bio')} rows={4} style={{ width: '100%' }} disabled={loading} />
          </label>
        </article>
        <aside className="surface-card content-card profile-preview-card">
          <p className="eyebrow">Live preview</p>
          <h3>{form.displayName || '—'}</h3>
          <p className="workspace-description" style={{ margin: '0.35rem 0' }}>{form.role || 'Role not set'}</p>
          <p className="helper-note">{form.studioName || 'Studio'} · {form.locationLabel || 'Local'}</p>
          {form.bio ? <p style={{ marginTop: 12 }}>{form.bio}</p> : null}
        </aside>
      </section>
    </div>
  );
}
