/**
 * Humanizers for product attribute / variant-axis keys and values shared by
 * the PDP server page (spec table) and the client purchase panel (axis
 * pickers). Pure module — safe to import from server and client components.
 */

const KEY_OVERRIDES: Record<string, string> = {
  gsm: 'Paper weight (GSM)',
  ink_type: 'Ink type',
  tip_size: 'Tip size',
  age_group: 'Age group',
  piece_count: 'Pieces',
  sheet_count: 'Sheets',
  pack: 'Pack of',
  nib: 'Nib',
  grip: 'Grip size',
};

/** `ink_type` → `Ink type`, `gsm` → `Paper weight (GSM)`, `color` → `Colour`. */
export function humanizeAxisKey(key: string): string {
  const override = KEY_OVERRIDES[key];
  if (override) return override;
  if (key === 'color') return 'Colour';
  const spaced = key.replace(/[-_]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** `short-handle` → `Short handle`, `kashmir-willow` → `Kashmir willow`, numbers pass through. */
export function humanizeAxisValue(value: string | number | unknown): string {
  if (typeof value === 'number') return String(value);
  const text = String(value ?? '').replace(/[-_]+/g, ' ').trim();
  if (text.length === 0) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Known colour-axis values → swatch colours (warm-adjusted to sit on Plume paper). */
export const AXIS_SWATCHES: Record<string, string> = {
  blue: '#3B5BA5',
  black: '#2A2620',
  grey: '#8C8478',
  gray: '#8C8478',
  green: '#5B7F62',
  yellow: '#D9A93F',
  red: '#B04A3E',
  white: '#F6F3EC',
  pink: '#C98A96',
  brown: '#8A6B52',
};
