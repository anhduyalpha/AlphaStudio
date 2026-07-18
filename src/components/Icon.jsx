import React, { useId } from 'react';
import { iconSprite, statusIconNames, toolIconNames } from '../assets/registry';

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
 * Shared AlphaStudio SVG icon. Icons are decorative by default because most
 * instances sit beside visible text. Pass `label` when the icon itself carries
 * meaning; icon-only buttons should keep their accessible label on the button.
 */
export default function Icon({
  name,
  size = 20,
  strokeWidth = 1.8,
  className = '',
  label,
}) {
  const titleId = useId();
  const resolved = resolveIconName(name);
  const meaningful = Boolean(label);

  return (
    <svg
      className={`alpha-icon ${className}`.trim()}
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
