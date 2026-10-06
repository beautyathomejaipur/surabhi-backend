import rateLimit from 'express-rate-limit';

// Bot/abuse protection: caps how many OTP emails a single IP can trigger,
// and how many verify attempts it can make, independent of the per-email
// cooldown and per-code attempt cap enforced in the route handlers.
export const otpSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many OTP requests. Please try again later.' },
});

export const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

// Public Contact Us form — generous enough for a genuine visitor retrying a
// typo, tight enough to stop a script from flooding the inquiries table.
export const contactFormLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many messages sent. Please try again later.' },
});

// Vendor login — slows down password guessing against a single outlet account.
export const vendorLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

// Super admin login — there is exactly one account, so this is the single
// biggest target for password guessing in the whole system. Tighter than
// the vendor limiter on purpose.
export const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

// Public "Partner with us" form — a real restaurant applies once; a few
// retries for typos is plenty.
export const vendorRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many applications from this network. Please try again in an hour.' },
});

// First-party analytics beacon. The browser batches events, so a genuine
// visitor sends a handful of requests a minute; this only stops floods.
export const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests.' },
});
