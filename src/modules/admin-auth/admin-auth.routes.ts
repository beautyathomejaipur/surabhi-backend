import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { verifyPassword } from '../../lib/password.js';
import { adminLoginLimiter } from '../../lib/rate-limit.js';
import { recordAudit } from '../../lib/audit.js';
import { requireAdminAuth } from './admin-auth.middleware.js';

export const adminAuthRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET!;
const ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
const ADMIN_PASSWORD_HASH = process.env.SUPER_ADMIN_PASSWORD_HASH;

// There is exactly one admin account in this system today (see BRD 13.9 for
// the future multi-role plan). It is credentialed via environment variables,
// not a database row, precisely so it can never be created, edited or
// deleted through the app itself — the only way to change it is to redeploy
// with new env vars.
if (!ADMIN_EMAIL || !ADMIN_PASSWORD_HASH) {
  console.warn(
    'SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD_HASH are not set — admin login will always fail until they are.',
  );
}

// POST /api/admin-auth/login
adminAuthRouter.post('/login', adminLoginLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const attemptedEmail = email.trim().toLowerCase();
  const valid =
    ADMIN_EMAIL &&
    ADMIN_PASSWORD_HASH &&
    attemptedEmail === ADMIN_EMAIL &&
    verifyPassword(password, ADMIN_PASSWORD_HASH);

  if (!valid) {
    recordAudit({
      actorType: 'SYSTEM',
      actorLabel: attemptedEmail || 'unknown',
      action: 'ADMIN_LOGIN_FAILED',
      entityType: 'Admin',
      entityId: 'super-admin',
    });
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  recordAudit({
    actorType: 'STAFF',
    actorId: 'super-admin',
    actorLabel: 'Super Admin',
    action: 'ADMIN_LOGIN',
    entityType: 'Admin',
    entityId: 'super-admin',
  });

  const token = jwt.sign(
    { sub: 'super-admin', role: 'SUPER_ADMIN', email: ADMIN_EMAIL },
    JWT_SECRET,
    { expiresIn: '12h' },
  );
  res.json({ token });
});

// GET /api/admin-auth/me — lets the frontend confirm a stored token is still
// valid (and thus keep "am I logged in" server-verified, not just "is there
// a token in localStorage").
adminAuthRouter.get('/me', requireAdminAuth, (req, res) => {
  res.json({ email: ADMIN_EMAIL, role: 'SUPER_ADMIN' });
});
