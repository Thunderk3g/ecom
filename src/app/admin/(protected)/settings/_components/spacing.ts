// Spacing-scale helpers shared between the server settings page and the client
// ThemeTab. Kept in a NON-'use client' module so the server component can call
// `scaleToSize` directly — Next.js forbids invoking a plain function exported
// from a 'use client' module on the server.

// Maps the discrete UI choice to the numeric multiplier stored in
// site_config.theme.spacingScale.
export const SPACING_VALUES: Record<'sm' | 'md' | 'lg', number> = {
  sm: 0.875,
  md: 1.0,
  lg: 1.25,
};

export function scaleToSize(scale: number): 'sm' | 'md' | 'lg' {
  if (scale <= 0.95) return 'sm';
  if (scale >= 1.1) return 'lg';
  return 'md';
}
