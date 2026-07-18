import React, { useEffect, useState } from 'react';
import { PageIntro, PrimaryButton, SecondaryButton, TextField } from '../components/Common';
import { api } from '../api/client';

export default function ProfileView({ notify }) {
  const [form, setForm] = useState({
    displayName: '',
    studioName: '',
    role: '',
    locationLabel: '',
    bio: '',
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getProfile()
      .then((p) => {
        setForm({
          displayName: p.displayName || '',
          studioName: p.studioName || '',
          role: p.role || '',
          locationLabel: p.locationLabel || '',
          bio: p.bio || '',
        });
      })
      .catch((err) => notify?.(err.message || 'Failed to load profile'))
      .finally(() => setLoading(false));
  }, [notify]);

  const save = async () => {
    try {
      const p = await api.saveProfile(form);
      setForm({
        displayName: p.displayName,
        studioName: p.studioName,
        role: p.role,
        locationLabel: p.locationLabel,
        bio: p.bio,
      });
      notify('Profile saved');
    } catch (err) {
      notify(err.message || 'Save failed');
    }
  };

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="view-stack">
      <PageIntro
        eyebrow="Manage / Profile Studio"
        title="Your local studio identity."
        description="Profile fields persist in SQLite and reload after restart."
        actions={
          <>
            <SecondaryButton icon="download" onClick={() => notify('Use the avatar SVG in /avatars for export.')}>
              Export SVG
            </SecondaryButton>
            <PrimaryButton icon="check" onClick={save} disabled={loading}>
              Save profile
            </PrimaryButton>
          </>
        }
      />
      <section className="profile-layout" style={{ display: 'grid', gap: 16 }}>
        <article className="surface-card content-card">
          <div className="form-grid">
            <TextField label="Display name" value={form.displayName} onChange={set('displayName')} placeholder="AlphaD" />
            <TextField label="Studio name" value={form.studioName} onChange={set('studioName')} placeholder="AlphaStudio" />
            <TextField label="Role" value={form.role} onChange={set('role')} placeholder="Product builder" />
            <TextField label="Location label" value={form.locationLabel} onChange={set('locationLabel')} placeholder="Localhost" />
          </div>
          <label className="field-group" style={{ marginTop: 12, display: 'block' }}>
            <span>Bio</span>
            <textarea value={form.bio} onChange={set('bio')} rows={4} style={{ width: '100%' }} />
          </label>
        </article>
        <aside className="surface-card content-card">
          <p className="eyebrow">Preview</p>
          <h3>{form.displayName || '—'}</h3>
          <p>{form.role}</p>
          <p>{form.studioName} · {form.locationLabel}</p>
        </aside>
      </section>
    </div>
  );
}
