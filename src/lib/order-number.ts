import { randomBytes } from 'crypto';

// SB + 2-digit year + day-of-year + 4 random base36 chars, e.g. "SB262701A9F3".
// Sortable-ish by date and short enough to read over a phone call, unlike a raw cuid.
export function generateOrderNumber(): string {
  const now = new Date();
  const year = String(now.getFullYear()).slice(-2);
  const startOfYear = Date.UTC(now.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((now.getTime() - startOfYear) / 86400000) + 1;
  const suffix = randomBytes(3).toString('hex').toUpperCase().slice(0, 4);
  return `SB${year}${String(dayOfYear).padStart(3, '0')}${suffix}`;
}
