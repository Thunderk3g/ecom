/**
 * Display formatters for the admin UI. Money is stored as integer minor units
 * (cents / paise); these helpers render and parse the major-unit string.
 */

/**
 * Format integer minor units to a localized currency string.
 * `formatMoney(123450, 'INR')` → "₹1,234.50".
 */
export function formatMoney(cents: number, currency = 'INR'): string {
  const major = cents / 100;
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(major);
  } catch {
    // Unknown currency code — fall back to a plain number with the code.
    return `${currency} ${major.toFixed(2)}`;
  }
}

/**
 * Parse a major-unit decimal string ("12.34") into integer minor units (1234).
 * Returns null when the input is not a finite number.
 */
export function parseMoneyToCents(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Render integer minor units as a bare major-unit string for form inputs ("12.34"). */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2);
}

/** Format a Date | ISO string to a short human date-time. */
export function formatDateTime(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

/** Format a Date | ISO string to a short date only. */
export function formatDate(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d);
}
