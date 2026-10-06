import { Router } from 'express';
import { Prisma, VendorRequestStatus, DietaryType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { isValidEmail, normalizeEmail } from '../../lib/email-validation.js';
import { vendorRequestLimiter } from '../../lib/rate-limit.js';
import { recordAudit } from '../../lib/audit.js';
import { sendVendorRequestEmails } from '../../lib/mail/index.js';
import { requireAdminAuth } from '../admin-auth/admin-auth.middleware.js';

export const vendorRequestsRouter = Router();

const STATUSES = Object.values(VendorRequestStatus);
const DIETARY = new Set<string>(Object.values(DietaryType));
const PHONE_RE = /^[6-9]\d{9}$/; // Indian mobile, without +91
const FSSAI_RE = /^\d{14}$/;

const LIMITS = {
  restaurantName: 120,
  ownerName: 80,
  city: 80,
  stationName: 120,
  message: 1500,
  adminNotes: 2000,
};

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

// Accepts "+91 98765 43210", "098765-43210", "9876543210" — stores the bare 10 digits.
function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let digits = value.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return PHONE_RE.test(digits) ? digits : null;
}

// POST /api/vendor-requests — public "Partner with us" application.
// `website` is a honeypot, same as the contact form.
vendorRequestsRouter.post('/', vendorRequestLimiter, async (req, res) => {
  const body = req.body ?? {};

  if (typeof body.website === 'string' && body.website.trim()) {
    return res.status(201).json({ success: true });
  }

  const restaurantName = cleanString(body.restaurantName, LIMITS.restaurantName);
  const ownerName = cleanString(body.ownerName, LIMITS.ownerName);
  const city = cleanString(body.city, LIMITS.city);
  const stationName = cleanString(body.stationName, LIMITS.stationName);
  const phone = normalizePhone(body.phone);
  const message = cleanString(body.message, LIMITS.message);

  if (!restaurantName) return res.status(400).json({ error: 'Please enter your restaurant name.' });
  if (!ownerName) return res.status(400).json({ error: 'Please enter the owner or manager name.' });
  if (!phone) return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
  if (!city) return res.status(400).json({ error: 'Please enter your city.' });
  if (!stationName) return res.status(400).json({ error: 'Please tell us the nearest railway station.' });

  if (typeof body.email !== 'string' || !body.email.trim()) {
    return res.status(400).json({ error: 'Please enter your email address.' });
  }
  const email = normalizeEmail(body.email);
  const emailCheck = isValidEmail(email);
  if (!emailCheck.valid) return res.status(400).json({ error: emailCheck.reason });

  let fssaiLicenseNo: string | null = null;
  if (typeof body.fssaiLicenseNo === 'string' && body.fssaiLicenseNo.trim()) {
    const digits = body.fssaiLicenseNo.replace(/\s/g, '');
    if (!FSSAI_RE.test(digits)) {
      return res.status(400).json({ error: 'FSSAI licence number should be 14 digits.' });
    }
    fssaiLicenseNo = digits;
  }

  const foodTypes = Array.isArray(body.foodTypes)
    ? [...new Set(body.foodTypes.filter((t: unknown): t is string => typeof t === 'string' && DIETARY.has(t)))]
    : [];

  let yearsInBusiness: number | null = null;
  if (body.yearsInBusiness !== undefined && body.yearsInBusiness !== null && body.yearsInBusiness !== '') {
    const n = Number(body.yearsInBusiness);
    if (!Number.isInteger(n) || n < 0 || n > 100) {
      return res.status(400).json({ error: 'Years in business should be a whole number.' });
    }
    yearsInBusiness = n;
  }

  // Only link a station the applicant actually picked from our list; a
  // free-typed station stays as text for the admin to map later.
  let stationId: string | null = null;
  if (typeof body.stationId === 'string' && body.stationId) {
    const station = await prisma.station.findUnique({ where: { id: body.stationId }, select: { id: true } });
    stationId = station?.id ?? null;
  }

  // Same phone re-applying while an earlier request is still open: update
  // that one instead of stacking duplicates in the admin queue.
  const openRequest = await prisma.vendorRequest.findFirst({
    where: { phone, status: { in: ['NEW', 'CONTACTED'] } },
    select: { id: true },
  });

  const data = {
    restaurantName,
    ownerName,
    phone,
    email,
    city,
    stationName,
    stationId,
    fssaiLicenseNo,
    foodTypes: foodTypes as DietaryType[],
    yearsInBusiness,
    message,
  };

  const request = openRequest
    ? await prisma.vendorRequest.update({ where: { id: openRequest.id }, data })
    : await prisma.vendorRequest.create({ data });

  if (!openRequest) {
    // Fire-and-forget — a mail outage must never lose an application.
    sendVendorRequestEmails({ restaurantName, ownerName, phone, email, city, stationName }).catch(() => {});
  }

  res.status(201).json({ success: true, id: request.id, updated: !!openRequest });
});

// ── Admin ─────────────────────────────

const adminSelect = {
  id: true,
  restaurantName: true,
  ownerName: true,
  phone: true,
  email: true,
  city: true,
  stationName: true,
  station: { select: { id: true, name: true, code: true } },
  fssaiLicenseNo: true,
  foodTypes: true,
  yearsInBusiness: true,
  message: true,
  status: true,
  adminNotes: true,
  reviewedAt: true,
  outletId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.VendorRequestSelect;

// GET /api/vendor-requests — admin queue. ?status= and ?q= optional.
// Returns counts per status alongside the list so the tabs don't need a second call.
vendorRequestsRouter.get('/', requireAdminAuth, async (req, res) => {
  const { status, q } = req.query;
  const where: Prisma.VendorRequestWhereInput = {};
  if (typeof status === 'string' && STATUSES.includes(status as VendorRequestStatus)) {
    where.status = status as VendorRequestStatus;
  }
  if (typeof q === 'string' && q.trim()) {
    const term = q.trim();
    where.OR = [
      { restaurantName: { contains: term, mode: 'insensitive' } },
      { ownerName: { contains: term, mode: 'insensitive' } },
      { city: { contains: term, mode: 'insensitive' } },
      { stationName: { contains: term, mode: 'insensitive' } },
      { email: { contains: term, mode: 'insensitive' } },
      { phone: { contains: term.replace(/\D/g, '') || term } },
    ];
  }

  const [requests, grouped] = await Promise.all([
    prisma.vendorRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300, select: adminSelect }),
    prisma.vendorRequest.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const counts: Record<string, number> = { ALL: 0, NEW: 0, CONTACTED: 0, APPROVED: 0, REJECTED: 0 };
  for (const g of grouped) {
    counts[g.status] = g._count._all;
    counts.ALL += g._count._all;
  }

  res.json({ requests, counts });
});

// PATCH /api/vendor-requests/:id — status, admin notes, and/or linking the
// outlet created from this request.
vendorRequestsRouter.patch('/:id', requireAdminAuth, async (req, res) => {
  const { status, adminNotes, outletId } = req.body ?? {};

  const existing = await prisma.vendorRequest.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'This request no longer exists.' });

  const data: Prisma.VendorRequestUpdateInput = {};

  if (status !== undefined) {
    if (typeof status !== 'string' || !STATUSES.includes(status as VendorRequestStatus)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }
    data.status = status as VendorRequestStatus;
    data.reviewedAt = status === 'NEW' ? null : new Date();
  }

  if (adminNotes !== undefined) {
    if (adminNotes !== null && typeof adminNotes !== 'string') {
      return res.status(400).json({ error: 'Notes must be text.' });
    }
    data.adminNotes = adminNotes ? adminNotes.trim().slice(0, LIMITS.adminNotes) || null : null;
  }

  if (outletId !== undefined) {
    if (typeof outletId !== 'string') return res.status(400).json({ error: 'Invalid outlet.' });
    const outlet = await prisma.outlet.findUnique({ where: { id: outletId }, select: { id: true } });
    if (!outlet) return res.status(400).json({ error: 'That outlet does not exist.' });
    data.outletId = outletId;
    data.status = 'APPROVED';
    data.reviewedAt = new Date();
  }

  const updated = await prisma.vendorRequest.update({ where: { id: existing.id }, data, select: adminSelect });

  if (data.status && data.status !== existing.status) {
    recordAudit({
      actorType: 'STAFF',
      actorLabel: 'Super Admin',
      action: 'vendor_request.status_changed',
      entityType: 'VendorRequest',
      entityId: existing.id,
      metadata: { from: existing.status, to: data.status, outletId: data.outletId ?? undefined },
    });
  }

  res.json(updated);
});

// DELETE /api/vendor-requests/:id — for spam that slipped past the honeypot.
vendorRequestsRouter.delete('/:id', requireAdminAuth, async (req, res) => {
  const existing = await prisma.vendorRequest.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!existing) return res.status(404).json({ error: 'This request no longer exists.' });
  await prisma.vendorRequest.delete({ where: { id: existing.id } });
  recordAudit({
    actorType: 'STAFF',
    actorLabel: 'Super Admin',
    action: 'vendor_request.deleted',
    entityType: 'VendorRequest',
    entityId: existing.id,
  });
  res.status(204).end();
});
