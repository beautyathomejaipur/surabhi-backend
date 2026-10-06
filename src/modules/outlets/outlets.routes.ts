import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { imageUpload } from '../../lib/upload.js';
import { uploadImage, deleteImage } from '../../lib/imagekit.js';
import { hashPassword, generateTempPassword } from '../../lib/password.js';
import { recordAudit } from '../../lib/audit.js';
import { slugify } from '../../lib/slugify.js';
import { requireAdminAuth } from '../admin-auth/admin-auth.middleware.js';

export const outletsRouter = Router();

// Every route here is staff-only: vendor contact info, commission rates and
// (via reset-password) plaintext temp passwords are not public data.
outletsRouter.use(requireAdminAuth);

const DIETARY_TYPES = new Set(['VEG', 'NON_VEG', 'JAIN', 'VEGAN']);

// Public storefront URL slug — same collision-avoidance pattern as
// categories.routes.ts's uniqueSlug, scoped to Outlet instead.
async function uniqueOutletSlug(base: string, excludeId?: string): Promise<string> {
  const cleanBase = base || 'restaurant';
  let slug = cleanBase;
  let suffix = 2;
  while (
    await prisma.outlet.findFirst({
      where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    })
  ) {
    slug = `${cleanBase}-${suffix++}`;
  }
  return slug;
}
const WEEKLY_OFF_VALUES = new Set([
  'NONE',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
]);
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const listSelect = {
  id: true,
  name: true,
  slug: true,
  ownerName: true,
  phone: true,
  alternatePhone: true,
  email: true,
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
  createdAt: true,
  updatedAt: true,
  permissions: { select: { module: true } },
  _count: { select: { menuItems: true, orders: true } },
} as const;

const VENDOR_MODULES = new Set(['MENU', 'CATEGORY']);

type ParsedOutletBody = {
  errors: string[];
  data: {
    name: string;
    stationId: string;
    ownerName: string;
    phone: string;
    alternatePhone: string | null;
    email: string | null;
    address: string | null;
    description: string | null;
    fssaiLicenseNo: string;
    fssaiExpiryDate: Date;
    gstNumber: string | null;
    foodTypes: string[];
    commissionPercent: number;
    deliveryCharge: number;
    minOrderValue: number;
    minOrderTimeMins: number;
    workingHoursStart: string;
    workingHoursEnd: string;
    weeklyOff: string;
  };
};

// Shared validation for create + update — every numeric/enum field is
// re-checked server-side because the frontend form must never be the only
// gate on values that feed billing/commission math later.
function parseOutletBody(body: Record<string, unknown>): ParsedOutletBody {
  const errors: string[] = [];
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

  const name = str(body.name);
  const stationId = str(body.stationId);
  const ownerName = str(body.ownerName);
  const phone = str(body.phone);
  const fssaiLicenseNo = str(body.fssaiLicenseNo);
  const fssaiExpiryDateRaw = str(body.fssaiExpiryDate);

  if (!name) errors.push('Vendor name is required.');
  if (!stationId) errors.push('Station is required.');
  if (!ownerName) errors.push('Owner/contact name is required.');
  if (!/^\d{10}$/.test(phone)) errors.push('Contact number must be a valid 10-digit number.');
  if (!fssaiLicenseNo) errors.push('FSSAI license number is required.');

  let fssaiExpiryDate = new Date(fssaiExpiryDateRaw);
  if (!fssaiExpiryDateRaw || Number.isNaN(fssaiExpiryDate.getTime())) {
    errors.push('A valid FSSAI license expiry date is required.');
    fssaiExpiryDate = new Date(0);
  }

  const alternatePhone = str(body.alternatePhone);
  if (alternatePhone && !/^\d{10}$/.test(alternatePhone)) {
    errors.push('Alternate contact number must be a valid 10-digit number.');
  }

  const email = str(body.email).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('Email address looks invalid.');
  }

  const commissionPercent = Number(body.commissionPercent);
  if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
    errors.push('Commission must be a number between 0 and 100.');
  }

  const deliveryCharge = Number(body.deliveryCharge);
  if (!Number.isFinite(deliveryCharge) || deliveryCharge < 0) {
    errors.push('Delivery charges must be a non-negative number.');
  }

  const minOrderValue = Number(body.minOrderValue);
  if (!Number.isFinite(minOrderValue) || minOrderValue < 0) {
    errors.push('Minimum order value must be a non-negative number.');
  }

  const minOrderTimeMins = Number(body.minOrderTimeMins);
  if (!Number.isInteger(minOrderTimeMins) || minOrderTimeMins <= 0) {
    errors.push('Minimum order time must be a whole number of minutes.');
  }

  const workingHoursStart = str(body.workingHoursStart);
  const workingHoursEnd = str(body.workingHoursEnd);
  if (!TIME_RE.test(workingHoursStart) || !TIME_RE.test(workingHoursEnd)) {
    errors.push('Working time must include a valid start and end time.');
  }

  const weeklyOff = str(body.weeklyOff).toUpperCase() || 'NONE';
  if (!WEEKLY_OFF_VALUES.has(weeklyOff)) {
    errors.push('Weekly off must be a valid day, or "NONE".');
  }

  let foodTypes: string[] = [];
  const rawFoodTypes = body.foodTypes;
  if (typeof rawFoodTypes === 'string') {
    foodTypes = rawFoodTypes.split(',').map((v) => v.trim().toUpperCase()).filter(Boolean);
  } else if (Array.isArray(rawFoodTypes)) {
    foodTypes = rawFoodTypes.map((v) => String(v).trim().toUpperCase());
  }
  if (foodTypes.length === 0) {
    errors.push('Select at least one food type.');
  } else if (!foodTypes.every((t) => DIETARY_TYPES.has(t))) {
    errors.push('Food type contains an invalid value.');
  }

  return {
    errors,
    data: {
      name,
      stationId,
      ownerName,
      phone,
      alternatePhone: alternatePhone || null,
      email: email || null,
      address: str(body.address) || null,
      description: str(body.description) || null,
      fssaiLicenseNo,
      fssaiExpiryDate,
      gstNumber: str(body.gstNumber) || null,
      foodTypes,
      commissionPercent,
      deliveryCharge,
      minOrderValue,
      minOrderTimeMins,
      workingHoursStart,
      workingHoursEnd,
      weeklyOff,
    },
  };
}

// GET /api/outlets — list vendors. ?q= searches name/owner/phone/email,
// ?stationId= and ?status= filter, ?active=true restricts to active ones.
outletsRouter.get('/', async (req, res) => {
  const { q, stationId, status, active } = req.query;
  const outlets = await prisma.outlet.findMany({
    where: {
      ...(typeof stationId === 'string' && stationId ? { stationId } : {}),
      ...(typeof status === 'string' && status ? { status: status as never } : {}),
      ...(active === 'true' ? { isActive: true } : {}),
      ...(typeof q === 'string' && q.trim()
        ? {
            OR: [
              { name: { contains: q.trim(), mode: 'insensitive' } },
              { ownerName: { contains: q.trim(), mode: 'insensitive' } },
              { phone: { contains: q.trim() } },
              { email: { contains: q.trim(), mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    select: listSelect,
    orderBy: { createdAt: 'desc' },
  });
  res.json(outlets);
});

// GET /api/outlets/:id
outletsRouter.get('/:id', async (req, res) => {
  const outlet = await prisma.outlet.findUnique({
    where: { id: req.params.id },
    select: { ...listSelect, address: true, description: true, gstNumber: true, fssaiLicenseNo: true, fssaiExpiryDate: true },
  });
  if (!outlet) return res.status(404).json({ error: 'Outlet not found' });
  res.json(outlet);
});

// POST /api/outlets — super admin onboards a new vendor.
// multipart/form-data: all vendor fields + optional image.
// A temp login password is generated server-side and returned exactly once
// in the response — only its hash is ever persisted.
outletsRouter.post('/', imageUpload.single('image'), async (req, res) => {
  const { errors, data } = parseOutletBody(req.body ?? {});
  if (errors.length > 0) {
    return res.status(400).json({ error: errors[0], errors });
  }

  const station = await prisma.station.findUnique({ where: { id: data.stationId } });
  if (!station) {
    return res.status(400).json({ error: 'Selected station does not exist.' });
  }

  if (data.email) {
    const existing = await prisma.outlet.findUnique({ where: { email: data.email } });
    if (existing) {
      return res.status(409).json({ error: 'Another vendor already uses this email for login.' });
    }
  }

  let imageUrl: string | undefined;
  let imagePublicId: string | undefined;
  if (req.file) {
    try {
      const uploaded = await uploadImage(req.file.buffer, 'surabhi/outlets');
      imageUrl = uploaded.url;
      imagePublicId = uploaded.publicId;
    } catch (err) {
      console.error('Vendor image upload failed', err);
      return res.status(502).json({ error: 'Image upload failed. Please try again.' });
    }
  }

  const tempPassword = data.email ? generateTempPassword() : undefined;
  const createdByLabel = typeof req.body?.createdByLabel === 'string' ? req.body.createdByLabel.trim() : undefined;
  const slug = await uniqueOutletSlug(slugify(`${data.name}-at-${station.name}`));

  const outlet = await prisma.outlet.create({
    data: {
      ...data,
      slug,
      foodTypes: data.foodTypes as never,
      imageUrl,
      imagePublicId,
      passwordHash: tempPassword ? hashPassword(tempPassword) : undefined,
      mustChangePassword: true,
      createdByLabel: createdByLabel || 'Admin',
      // A vendor onboarded directly through this form (not the public
      // vendor-request funnel) is approved and enabled immediately.
      status: 'APPROVED',
      isActive: true,
    },
    select: listSelect,
  });

  recordAudit({
    actorType: 'STAFF',
    actorLabel: createdByLabel || 'Admin',
    action: 'VENDOR_CREATED',
    entityType: 'Outlet',
    entityId: outlet.id,
    metadata: { name: outlet.name },
  });

  res.status(201).json({
    outlet,
    // Present only on this one response — the plaintext is never stored or
    // retrievable again. Share it with the vendor now, or reset it later.
    loginCredentials: data.email && tempPassword ? { email: data.email, tempPassword } : null,
  });
});

// PATCH /api/outlets/:id — full-form update (the admin form always resubmits every
// field, so this isn't a sparse patch of individual keys). A new image replaces
// (and deletes) the old one.
outletsRouter.patch('/:id', imageUpload.single('image'), async (req, res) => {
  const existing = await prisma.outlet.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Outlet not found' });

  const { errors, data } = parseOutletBody(req.body ?? {});
  if (errors.length > 0) {
    return res.status(400).json({ error: errors[0], errors });
  }

  let station: { name: string } | null = null;
  if (data.stationId !== existing.stationId) {
    station = await prisma.station.findUnique({ where: { id: data.stationId }, select: { name: true } });
    if (!station) return res.status(400).json({ error: 'Selected station does not exist.' });
  }

  // Slug tracks name/station so a renamed vendor gets a fresh, matching URL —
  // same trade-off categories.routes.ts already makes: a bookmarked old link
  // 404s after a rename, but nobody typically shares "yesterday's" vendor URL.
  let slug: string | undefined;
  if (!existing.slug || data.name !== existing.name || data.stationId !== existing.stationId) {
    if (!station) station = await prisma.station.findUnique({ where: { id: data.stationId }, select: { name: true } });
    slug = await uniqueOutletSlug(slugify(`${data.name}-at-${station?.name ?? ''}`), existing.id);
  }

  if (data.email && data.email !== existing.email) {
    const conflict = await prisma.outlet.findUnique({ where: { email: data.email } });
    if (conflict) {
      return res.status(409).json({ error: 'Another vendor already uses this email for login.' });
    }
  }

  let imageUrl = existing.imageUrl;
  let imagePublicId = existing.imagePublicId;
  if (req.file) {
    try {
      const uploaded = await uploadImage(req.file.buffer, 'surabhi/outlets');
      imageUrl = uploaded.url;
      imagePublicId = uploaded.publicId;
    } catch (err) {
      console.error('Vendor image upload failed', err);
      return res.status(502).json({ error: 'Image upload failed. Please try again.' });
    }
  }

  const outlet = await prisma.outlet.update({
    where: { id: existing.id },
    data: { ...data, slug, foodTypes: data.foodTypes as never, imageUrl, imagePublicId },
    select: listSelect,
  });

  if (req.file && existing.imagePublicId) {
    deleteImage(existing.imagePublicId).catch(() => {});
  }

  recordAudit({
    actorType: 'STAFF',
    actorLabel: typeof req.body?.createdByLabel === 'string' ? req.body.createdByLabel.trim() : 'Admin',
    action: 'VENDOR_UPDATED',
    entityType: 'Outlet',
    entityId: outlet.id,
  });

  res.json(outlet);
});

// PATCH /api/outlets/:id/status — activate/deactivate a vendor (soft toggle,
// preferred over delete for anything with order history).
outletsRouter.patch('/:id/status', async (req, res) => {
  const { isActive } = req.body ?? {};
  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ error: 'isActive must be a boolean.' });
  }
  const outlet = await prisma.outlet.update({
    where: { id: req.params.id },
    data: { isActive },
    select: listSelect,
  });
  recordAudit({
    actorType: 'STAFF',
    actorLabel: 'Admin',
    action: isActive ? 'VENDOR_ACTIVATED' : 'VENDOR_DEACTIVATED',
    entityType: 'Outlet',
    entityId: outlet.id,
  });
  res.json(outlet);
});

// PATCH /api/outlets/:id/permissions — Super Admin grants/revokes what this
// vendor can manage from their own panel. Body: { modules: string[] } — the
// full desired set, replacing whatever was granted before (not a diff/patch
// of individual modules, to keep "what does this vendor have right now"
// trivially readable from one request).
outletsRouter.patch('/:id/permissions', async (req, res) => {
  const outlet = await prisma.outlet.findUnique({ where: { id: req.params.id } });
  if (!outlet) return res.status(404).json({ error: 'Outlet not found' });

  const { modules } = req.body ?? {};
  if (!Array.isArray(modules) || !modules.every((m) => typeof m === 'string')) {
    return res.status(400).json({ error: 'modules must be an array of strings.' });
  }
  const uniqueModules = [...new Set(modules.map((m) => m.toUpperCase()))];
  if (!uniqueModules.every((m) => VENDOR_MODULES.has(m))) {
    return res.status(400).json({ error: `modules must only contain: ${[...VENDOR_MODULES].join(', ')}.` });
  }

  await prisma.$transaction([
    prisma.outletPermission.deleteMany({ where: { outletId: outlet.id } }),
    ...uniqueModules.map((module) =>
      prisma.outletPermission.create({ data: { outletId: outlet.id, module, actions: ['MANAGE'] } }),
    ),
  ]);

  recordAudit({
    actorType: 'STAFF',
    actorLabel: 'Admin',
    action: 'VENDOR_PERMISSIONS_UPDATED',
    entityType: 'Outlet',
    entityId: outlet.id,
    metadata: { modules: uniqueModules },
  });

  const updated = await prisma.outlet.findUnique({ where: { id: outlet.id }, select: listSelect });
  res.json(updated);
});

// POST /api/outlets/:id/reset-password — admin issues a fresh temp password
// for a vendor who's locked out; forces a change on next login.
outletsRouter.post('/:id/reset-password', async (req, res) => {
  const outlet = await prisma.outlet.findUnique({ where: { id: req.params.id } });
  if (!outlet) return res.status(404).json({ error: 'Outlet not found' });
  if (!outlet.email) {
    return res.status(400).json({ error: 'This vendor has no login email on file yet.' });
  }

  const tempPassword = generateTempPassword();
  await prisma.outlet.update({
    where: { id: outlet.id },
    data: { passwordHash: hashPassword(tempPassword), mustChangePassword: true },
  });

  recordAudit({
    actorType: 'STAFF',
    actorLabel: 'Admin',
    action: 'VENDOR_PASSWORD_RESET',
    entityType: 'Outlet',
    entityId: outlet.id,
  });

  res.json({ email: outlet.email, tempPassword });
});

// DELETE /api/outlets/:id — blocked once the outlet has any order or menu
// history; deactivate instead so historical orders keep a valid reference.
outletsRouter.delete('/:id', async (req, res) => {
  const outlet = await prisma.outlet.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { menuItems: true, orders: true } } },
  });
  if (!outlet) return res.status(404).json({ error: 'Outlet not found' });

  if (outlet._count.orders > 0 || outlet._count.menuItems > 0) {
    return res.status(409).json({
      error: 'This vendor has orders or menu items on record. Deactivate it instead of deleting.',
    });
  }

  await prisma.outlet.delete({ where: { id: req.params.id } });
  if (outlet.imagePublicId) {
    deleteImage(outlet.imagePublicId).catch(() => {});
  }

  recordAudit({
    actorType: 'STAFF',
    actorLabel: 'Admin',
    action: 'VENDOR_DELETED',
    entityType: 'Outlet',
    entityId: outlet.id,
    metadata: { name: outlet.name },
  });

  res.status(204).send();
});
