import React, { useId } from 'react';
import { iconSprite, statusIconNames, toolIconNames } from '../../assets/registry';

export const iconAliases = Object.freeze({
  grid: 'dashboard',
  swap: 'converter',
  play: 'media',
  text: 'text-ocr',
  palette: 'color',
  shield: 'security',
  code: 'developer',
  clock: 'activity',
  user: 'profile',
});

export const utilityIconNames = Object.freeze([
  'scan', 'droplet', 'pen', 'refresh', 'wand', 'eye', 'key', 'terminal',
  'sparkles', 'file', 'search', 'menu', 'close', 'moon', 'sun', 'upload',
  'plus', 'arrow', 'layers', 'scissors', 'minimize', 'sort', 'lock', 'copy',
  'download', 'check', 'trash', 'link', 'offline',
]);

export const iconNames = Object.freeze([
  ...new Set([...toolIconNames, ...statusIconNames, ...utilityIconNames]),
]);

const knownIcons = new Set(iconNames);

export function resolveIconName(name) {
  const resolved = iconAliases[name] || name;
  return knownIcons.has(resolved) ? resolved : 'dashboard';
}

/**
 * Registry-backed AlphaStudio icon. It is decorative by default because most
 * uses sit beside visible copy. Pass `label` only when the icon carries meaning
 * by itself; icon-only buttons keep their accessible name on the button.
 */
export default function Icon({
  name,
  size = 20,
  strokeWidth = 1.8,
  className = '',
  label,
}) {
  const titleId = useId();
  const meaningful = Boolean(label);
  const resolved = resolveIconName(name);

  return (
    <svg
      className={`icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={meaningful ? undefined : 'true'}
      aria-labelledby={meaningful ? titleId : undefined}
      role={meaningful ? 'img' : undefined}
      focusable="false"
    >
      {meaningful ? <title id={titleId}>{label}</title> : null}
      <use href={`${iconSprite}#icon-${resolved}`} />
    </svg>
  );
}
