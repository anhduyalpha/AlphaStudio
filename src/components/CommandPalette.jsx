import React from 'react';
import { useMemo, useState } from 'react';
import Icon from './Icon';

export default function CommandPalette({ open, navigation, onClose, onNavigate }) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => navigation.filter((item) => item.label.toLowerCase().includes(query.toLowerCase())), [navigation, query]);
  if (!open) return null;
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Search AlphaStudio"><button className="modal-scrim" type="button" onClick={onClose} aria-label="Close search" /><div className="command-palette"><div className="command-input"><Icon name="search" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search workspaces and settings…" /><kbd>Esc</kbd></div><div className="command-results">{results.map((item) => <button type="button" key={item.id} onClick={() => { onNavigate(item.id); onClose(); }}><span><Icon name={item.icon} /><b>{item.label}</b></span><small>{item.group}</small></button>)}{results.length === 0 ? <p>No workspace found.</p> : null}</div></div></div>;
}
