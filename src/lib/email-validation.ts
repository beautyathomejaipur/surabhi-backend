// RFC 5322-ish practical email regex — strict enough to reject obvious junk
// without rejecting valid real-world addresses (+tags, subdomains, etc).
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

// Common disposable/throwaway email providers — blocked so only real,
// reachable addresses can create an account.
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  'tempmail.com',
  'temp-mail.org',
  'guerrillamail.com',
  'guerrillamail.info',
  '10minutemail.com',
  'yopmail.com',
  'trashmail.com',
  'throwawaymail.com',
  'getnada.com',
  'fakeinbox.com',
  'sharklasers.com',
]);

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(raw: string): { valid: boolean; reason?: string } {
  const email = normalizeEmail(raw);

  if (!email || email.length > 254) {
    return { valid: false, reason: 'Email is required.' };
  }
  if (!EMAIL_REGEX.test(email)) {
    return { valid: false, reason: 'Enter a valid email address.' };
  }

  const domain = email.split('@')[1];
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { valid: false, reason: 'Disposable email addresses are not allowed.' };
  }

  return { valid: true };
}
