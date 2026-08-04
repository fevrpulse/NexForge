import React from 'react';
import * as Icons from './icons.jsx';

/**
 * Safe wrapper — never throws ReferenceError if the icon export is missing
 * (circular import / stale HMR / partial bundle).
 */
export default function SafeNavIcon({ id, size = 18 }) {
  const Cmp = Icons?.NavIcon;
  if (typeof Cmp !== 'function') return null;
  try {
    return <Cmp id={id} size={size} />;
  } catch {
    return null;
  }
}
