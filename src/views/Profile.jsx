import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Icon,
  Skeleton,
  StatusBadge,
} from '../components/index.jsx';

export const EMPTY_PROFILE = Object.freeze({
  displayName: '',
  studioName: '',
  role: '',
  locationLabel: '',
  bio: '',
});

export function normalizeProfile(value) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(
    Object.keys(EMPTY_PROFILE).map((key) => [key, String(source[key] || '')]),
  );
}

export function profileChanged(profile, baseline) {
  if (!baseline) return false;
  return Object.keys(EMPTY_PROFILE).some(
    (key) => String(profile?.[key] || '') !== String(baseline?.[key] || ''),
  );
}

export function profileInitials(profile) {
  const source = profile?.displayName || profile?.studioName || 'Alpha Studio';
  const parts = String(source).trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'AS';
}

export default function Profile() {
  const [form, setForm] = useState(EMPTY_PROFILE);
  const [baseline, setBaseline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dirty = useMemo(() => profileChanged(form, baseline), [baseline, form]);

  const loadProfile = async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await api.getProfile();
      const next = normalizeProfile(payload);
      setForm(next);
      setBaseline(next);
    } catch (loadError) {
      setError(loadError?.message || 'Could not load the local studio profile.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProfile();
  }, []);

  const patch = (key, value) => {
    setNotice('');
    setForm((current) => ({ ...current, [key]: value }));
  };

  const reset = () => {
    if (!baseline) return;
    setForm(baseline);
    setError('');
    setNotice('Unsaved profile changes reset.');
  };

  const save = async () => {
    if (saving || !dirty) return;
    if (!form.displayName.trim() && !form.studioName.trim()) {
      setError('Add a display name or studio name before saving.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = await api.saveProfile(form);
      const next = normalizeProfile(payload);
      setForm(next);
      setBaseline(next);
      setNotice('Local studio profile saved.');
    } catch (saveError) {
      setError(saveError?.message || 'Could not save the local studio profile.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="profile-view" aria-label="Loading Profile">
        <Skeleton variant="row" lines={7} label="Loading Profile" />
      </div>
    );
  }

  return (
    <div className="profile-view">
      <section className="profile-hero" aria-labelledby="profile-title">
        <div>
          <p className="view-eyebrow">Local identity</p>
          <h2 id="profile-title">Studio profile</h2>
          <p>Shape the identity shown inside this local workspace and preview every change before saving.</p>
        </div>
        <div className="profile-hero__actions">
          <Button variant="ghost" disabled={!dirty || saving} onClick={reset}>Reset changes</Button>
          <Button variant="primary" icon="check" busy={saving} disabled={!dirty} onClick={save}>
            {dirty ? 'Save profile' : 'Saved'}
          </Button>
        </div>
      </section>

      {notice ? <p className="profile-notice" role="status">{notice}</p> : null}
      {error ? (
        <ErrorState
          title="Profile needs attention"
          message={error}
          actionLabel={dirty ? 'Try saving again' : 'Reload profile'}
          onAction={dirty ? save : loadProfile}
          actionDisabled={saving}
        />
      ) : null}

      <div className="profile-layout">
        <Card
          className="profile-form-card"
          title="Identity"
          subtitle="Persisted in the local SQLite profile"
          actions={<StatusBadge tone={dirty ? 'warning' : 'success'}>{dirty ? 'Unsaved' : 'Saved'}</StatusBadge>}
        >
          <div className="profile-fields">
            <Field
              label="Display name"
              value={form.displayName}
              placeholder="AlphaD"
              maxLength={80}
              onChange={(event) => patch('displayName', event.currentTarget.value)}
            />
            <Field
              label="Studio name"
              value={form.studioName}
              placeholder="AlphaStudio"
              maxLength={80}
              onChange={(event) => patch('studioName', event.currentTarget.value)}
            />
            <Field
              label="Role"
              value={form.role}
              placeholder="Product builder"
              maxLength={120}
              onChange={(event) => patch('role', event.currentTarget.value)}
            />
            <Field
              label="Location label"
              value={form.locationLabel}
              placeholder="Personal workstation"
              maxLength={120}
              onChange={(event) => patch('locationLabel', event.currentTarget.value)}
            />
            <Field
              className="profile-bio-field"
              label="Bio"
              hint={`${form.bio.length}/2000 characters`}
              variant="textarea"
              value={form.bio}
              rows={5}
              maxLength={2000}
              placeholder="A short note about this studio."
              onChange={(event) => patch('bio', event.currentTarget.value)}
            />
          </div>
        </Card>

        <aside className="profile-preview" aria-label="Profile preview">
          <p className="view-eyebrow">Live preview</p>
          <div className="profile-preview__avatar" aria-hidden="true">{profileInitials(form)}</div>
          <div className="profile-preview__identity">
            <h2>{form.displayName || 'Your name'}</h2>
            <p>{form.role || 'Role not set'}</p>
          </div>
          <dl>
            <div>
              <dt><Icon name="sparkles" /> Studio</dt>
              <dd>{form.studioName || 'Studio not set'}</dd>
            </div>
            <div>
              <dt><Icon name="link" /> Location</dt>
              <dd>{form.locationLabel || 'Location not set'}</dd>
            </div>
          </dl>
          <p className="profile-preview__bio">
            {form.bio || 'Add a short bio to make this local studio feel like yours.'}
          </p>
          <span className="profile-preview__privacy"><Icon name="lock" /> Stored only in local SQLite</span>
        </aside>
      </div>
    </div>
  );
}
