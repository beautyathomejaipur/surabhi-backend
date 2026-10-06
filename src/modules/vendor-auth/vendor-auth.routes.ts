import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../../lib/prisma.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { vendorLoginLimiter } from '../../lib/rate-limit.js';
import { recordAudit } from '../../lib/audit.js';
import { withStatus } from '../../lib/outlet-status.js';
import { requireVendorAuth } from './vendor-auth.middleware.js';

export const vendorAuthRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET!;

const outletProfileSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  alternatePhone: true,
  address: true,
  description: true,
  imageUrl: true,
  station: { select: { id: true, name: true, code: true } },
  foodTypes: true,
  commissionPercent: true,
  deliveryCharge: true,
  minOrderValue: true,
  minOrderTimeMins: true,
  workingHoursStart: true,
  workingHoursEnd: true,
  weeklyOff: true,
  availability: true,
  status: true,
  isActive: true,
  mustChangePassword: true,
  lastLoginAt: true,
  permissions: { select: { module: true, actions: true } },
} as const;

// POST /api/vendor-auth/login — a vendor's own-panel login, separate from
// customer OTP auth and (eventually) staff auth. Credentials are provisioned
// by the super admin when the outlet is created (see outlets.routes.ts).
vendorAuthRouter.post('/login', vendorLoginLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const outlet = await prisma.outlet.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!outlet || !outlet.passwordHash || !verifyPassword(password, outlet.passwordHash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  if (!outlet.isActive || outlet.status !== 'APPROVED') {
    return res.status(403).json({ error: 'This outlet account is not active yet. Contact the operations team.' });
  }

  await prisma.outlet.update({ where: { id: outlet.id }, data: { lastLoginAt: new Date() } });
  recordAudit({
    actorType: 'VENDOR',
    actorId: outlet.id,
    actorLabel: outlet.name,
    action: 'VENDOR_LOGIN',
    entityType: 'Outlet',
    entityId: outlet.id,
  });

  const token = jwt.sign({ sub: outlet.id, role: 'VENDOR' }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, mustChangePassword: outlet.mustChangePassword });
});

// GET /api/vendor-auth/me — the signed-in vendor's own outlet profile.
vendorAuthRouter.get('/me', requireVendorAuth, async (req, res) => {
  const outlet = await prisma.outlet.findUnique({
    where: { id: req.outletId },
    select: outletProfileSelect,
  });
  if (!outlet) return res.status(404).json({ error: 'Outlet not found.' });
  res.json(withStatus(outlet));
});

// POST /api/vendor-auth/change-password
// Body: { currentPassword, newPassword }. currentPassword is still required
// even on the forced first-login change, so a shared/guessed temp password
// alone can't be used to lock the real owner out.
vendorAuthRouter.post('/change-password', requireVendorAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'Current and new password are required.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }

  const outlet = await prisma.outlet.findUnique({ where: { id: req.outletId } });
  if (!outlet?.passwordHash || !verifyPassword(currentPassword, outlet.passwordHash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  await prisma.outlet.update({
    where: { id: outlet.id },
    data: { passwordHash: hashPassword(newPassword), mustChangePassword: false },
  });
  recordAudit({
    actorType: 'VENDOR',
    actorId: outlet.id,
    actorLabel: outlet.name,
    action: 'VENDOR_PASSWORD_CHANGED',
    entityType: 'Outlet',
    entityId: outlet.id,
  });

  res.json({ success: true });
});

// PATCH /api/vendor-auth/availability — the vendor's own quick open/busy/closed toggle.
vendorAuthRouter.patch('/availability', requireVendorAuth, async (req, res) => {
  const { availability } = req.body ?? {};
  if (!['OPEN', 'BUSY', 'TEMPORARILY_CLOSED'].includes(availability)) {
    return res.status(400).json({ error: 'availability must be OPEN, BUSY or TEMPORARILY_CLOSED.' });
  }
  const outlet = await prisma.outlet.update({
    where: { id: req.outletId },
    data: { availability },
    select: outletProfileSelect,
  });
  res.json(withStatus(outlet));
});
