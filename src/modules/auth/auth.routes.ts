import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../../lib/prisma.js';
import { isValidEmail, normalizeEmail } from '../../lib/email-validation.js';
import { generateOtpCode, hashOtpCode } from '../../lib/otp.js';
import { sendOtpEmail, sendWelcomeEmail } from '../../lib/mail/index.js';
import { otpSendLimiter, otpVerifyLimiter } from '../../lib/rate-limit.js';

export const authRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET!;
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 45 * 1000; // 45 seconds between sends for the same email
const MAX_OTP_ATTEMPTS = 5;

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// Shared by both the OTP and Google flows — finds or creates the Customer
// row, fires the appropriate (fire-and-forget) email, and signs the same
// 30-day session JWT so the frontend's login() doesn't need to know which
// method was used.
async function signInCustomer(email: string, name: string | null) {
  const existing = await prisma.customer.findUnique({ where: { email } });
  const isNewUser = !existing;

  const customer = existing
    ? await prisma.customer.update({ where: { email }, data: { lastLoginAt: new Date() } })
    : await prisma.customer.create({ data: { email, name: name ?? undefined, lastLoginAt: new Date() } });

  // Only a brand-new customer gets an email here — an existing one just
  // signs in silently, since the login itself already required an OTP sent
  // to this same inbox.
  if (isNewUser) {
    sendWelcomeEmail(customer.email, customer.name).catch((err) =>
      console.error('Failed to send welcome email', err),
    );
  }

  const token = jwt.sign(
    { sub: customer.id, email: customer.email, role: 'CUSTOMER' },
    JWT_SECRET,
    { expiresIn: '30d' },
  );

  return { token, customer, isNewUser };
}

// POST /api/auth/otp/send
// Body: { email: string, website?: string }
// `website` is a honeypot field — a real user never sees or fills it (hidden via CSS
// on the frontend). Any bot that blindly fills every form field trips it.
authRouter.post('/otp/send', otpSendLimiter, async (req, res) => {
  const { email: rawEmail, website } = req.body ?? {};

  if (typeof website === 'string' && website.trim().length > 0) {
    // Silently pretend success so the bot gets no signal it was caught.
    return res.json({ success: true });
  }

  if (typeof rawEmail !== 'string') {
    return res.status(400).json({ error: 'Email is required.' });
  }

  const email = normalizeEmail(rawEmail);
  const validation = isValidEmail(email);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.reason });
  }

  const existingOtp = await prisma.emailOtp.findUnique({ where: { email } });
  if (existingOtp && Date.now() - existingOtp.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    const waitSeconds = Math.ceil(
      (RESEND_COOLDOWN_MS - (Date.now() - existingOtp.createdAt.getTime())) / 1000,
    );
    return res.status(429).json({ error: `Please wait ${waitSeconds}s before requesting another code.` });
  }

  const code = generateOtpCode();
  const codeHash = hashOtpCode(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await prisma.emailOtp.upsert({
    where: { email },
    update: { codeHash, attempts: 0, expiresAt, createdAt: new Date() },
    create: { email, codeHash, expiresAt },
  });

  try {
    await sendOtpEmail(email, code);
  } catch (err) {
    console.error('Failed to send OTP email', err);
    return res.status(502).json({ error: 'Could not send the verification email. Try again shortly.' });
  }

  res.json({ success: true });
});

// POST /api/auth/otp/verify
// Body: { email: string, code: string }
authRouter.post('/otp/verify', otpVerifyLimiter, async (req, res) => {
  const { email: rawEmail, code } = req.body ?? {};

  if (typeof rawEmail !== 'string' || typeof code !== 'string') {
    return res.status(400).json({ error: 'Email and code are required.' });
  }

  const email = normalizeEmail(rawEmail);
  const otp = await prisma.emailOtp.findUnique({ where: { email } });

  if (!otp) {
    return res.status(400).json({ error: 'Request a new code first.' });
  }
  if (otp.expiresAt.getTime() < Date.now()) {
    await prisma.emailOtp.delete({ where: { email } });
    return res.status(400).json({ error: 'Code expired. Request a new one.' });
  }
  if (otp.attempts >= MAX_OTP_ATTEMPTS) {
    await prisma.emailOtp.delete({ where: { email } });
    return res.status(429).json({ error: 'Too many incorrect attempts. Request a new code.' });
  }

  if (hashOtpCode(code) !== otp.codeHash) {
    await prisma.emailOtp.update({ where: { email }, data: { attempts: { increment: 1 } } });
    return res.status(401).json({ error: 'Incorrect code.' });
  }

  await prisma.emailOtp.delete({ where: { email } });

  const result = await signInCustomer(email, null);
  res.json(result);
});

// POST /api/auth/google
// Body: { idToken: string } — the credential string from Google Identity
// Services' Sign in with Google button (an ID token, not an access token).
authRouter.post('/google', otpVerifyLimiter, async (req, res) => {
  if (!googleClient || !GOOGLE_CLIENT_ID) {
    return res.status(503).json({ error: 'Google sign-in is not configured on this server.' });
  }

  const { idToken } = req.body ?? {};
  if (typeof idToken !== 'string' || !idToken) {
    return res.status(400).json({ error: 'Missing Google credential.' });
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: 'Could not verify Google sign-in. Please try again.' });
  }

  if (!payload?.email) {
    return res.status(401).json({ error: 'Google did not share an email address.' });
  }
  if (payload.email_verified === false) {
    return res.status(401).json({ error: 'Please use a verified Google email address.' });
  }

  const email = normalizeEmail(payload.email);
  const result = await signInCustomer(email, payload.name ?? null);
  res.json(result);
});
