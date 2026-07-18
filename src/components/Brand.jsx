import React from 'react';
import { brandAssets } from '../assets/registry';

export function BrandMark({ size = 48, className = '', meaningful = false }) {
  return (
    <img
      className={`brand-mark ${className}`.trim()}
      src={brandAssets.mark}
      alt={meaningful ? 'AlphaStudio' : ''}
      aria-hidden={meaningful ? undefined : 'true'}
      width={size}
      height={size}
      decoding="async"
    />
  );
}

export function BrandLockup({ mode = 'dark', width = 310, className = '' }) {
  const src = mode === 'light' ? brandAssets.horizontalLight : brandAssets.horizontal;
  return (
    <img
      className={`brand-lockup ${className}`.trim()}
      src={src}
      alt="AlphaStudio — local creative utilities"
      width={width}
      height={Math.round(width * (76 / 360))}
      decoding="async"
    />
  );
}
