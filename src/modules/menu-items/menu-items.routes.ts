import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { imageUpload } from '../../lib/upload.js';
import { uploadImage, deleteImage } from '../../lib/imagekit.js';
import { requireAdminOrVendorPermission } from '../vendor-auth/vendor-auth.middleware.js';

export const menuItemsRouter = Router();

const DIETARY_TYPES = new Set(['VEG', 'NON_VEG', 'JAIN', 'VEGAN']);

const listInclude = {
  category: { select: { id: true, name: true } },
  outlet: { select: { id: true, name: true, stationId: true } },
} as const;

type ParsedBody = {
  errors: string[];
  data: {
    name: string;
    description: string | null;
    outletId: string;
    categoryId: string;
    price: number;
    discountPercent: number;
    taxPercent: number;
    dietaryType: string;
    prepTimeMins: number | null;
    displayOrder: number;
  };
};

function parseBody(body: Record<string, unknown>): ParsedBody {
  const errors: string[] = [];
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

  const name = str(body.name);
  const outletId = str(body.outletId);
  const categoryId = str(body.categoryId);
  const dietaryType = str(body.dietaryType).toUpperCase();

  if (!name) errors.push('Item name is required.');
  if (!outletId) errors.push('Vendor is required.');
  if (!categoryId) errors.push('Category is required.');
  if (!DIETARY_TYPES.has(dietaryType)) errors.push('Select a valid food type.');

  const price = Number(body.price);
  if (!Number.isFinite(price) || price <= 0) errors.push('Price must be a positive number.');

  const taxPercent = body.taxPercent !== undefined && body.taxPercent !== '' ? Number(body.taxPercent) : 0;
  if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) {
    errors.push('Tax % must be between 0 and 100.');
  }

  const discountPercent =
    body.discountPercent !== undefined && body.discountPercent !== '' ? Number(body.discountPercent) : 0;
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 90) {
    errors.push('Discount % must be between 0 and 90.');
  }

  const displayOrder = body.displayOrder !== undefined && body.displayOrder !== '' ? Number(body.displayOrder) : 0;
  if (!Number.isFinite(displayOrder)) errors.push('Display order must be a number.');

  let prepTimeMins: number | null = null;
  if (body.prepTimeMins !== undefined && body.prepTimeMins !== '') {
    const parsed = Number(body.prepTimeMins);
    if (!Number.isInteger(parsed) || parsed <= 0) errors.push('Prep time must be a whole number of minutes.');
    else prepTimeMins = parsed;
  }

  return {
    errors,
    data: {
      name,
      description: str(body.description) || null,
      outletId,
      categoryId,
      price,
      discountPercent,
      taxPercent,
      dietaryType,
      prepTimeMins,
      displayOrder,
    },
  };
}

// GET /api/menu-items — ?outletId=, ?categoryId=, ?stationId=, ?available=true, ?q=
menuItemsRouter.get('/', async (req, res) => {
  const { outletId, categoryId, stationId, available, q } = req.query;
  const items = await prisma.menuItem.findMany({
    where: {
      ...(typeof outletId === 'string' && outletId ? { outletId } : {}),
      ...(typeof categoryId === 'string' && categoryId ? { categoryId } : {}),
      ...(typeof stationId === 'string' && stationId ? { outlet: { stationId } } : {}),
      ...(available === 'true' ? { isAvailable: true } : {}),
      ...(typeof q === 'string' && q.trim()
        ? { name: { contains: q.trim(), mode: 'insensitive' } }
        : {}),
    },
    include: listInclude,
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
  });
  res.json(items);
});

// GET /api/menu-items/:id
menuItemsRouter.get('/:id', async (req, res) => {
  const item = await prisma.menuItem.findUnique({ where: { id: req.params.id }, include: listInclude });
  if (!item) return res.status(404).json({ error: 'Menu item not found' });
  res.json(item);
});

// POST /api/menu-items — multipart/form-data. Admin can create for any
// outlet; a vendor with the MENU permission can only ever create for their
// own outlet — req.outletId (from the verified JWT) wins over anything the
// client sent in the body, so a vendor can never plant an item on another
// outlet just by editing the request.
menuItemsRouter.post(
  '/',
  requireAdminOrVendorPermission('MENU'),
  imageUpload.single('image'),
  async (req, res) => {
    // Force before validation, not after — otherwise a vendor request with
    // no outletId in the body fails parseBody's "Vendor is required" check
    // before we ever get a chance to fill it in from the JWT.
    if (req.outletId) req.body.outletId = req.outletId;
    const { errors, data } = parseBody(req.body ?? {});
    if (errors.length > 0) return res.status(400).json({ error: errors[0], errors });

    const [outlet, category] = await Promise.all([
      prisma.outlet.findUnique({ where: { id: data.outletId } }),
      prisma.category.findUnique({ where: { id: data.categoryId } }),
    ]);
    if (!outlet) return res.status(400).json({ error: 'Selected vendor does not exist.' });
    if (!category) return res.status(400).json({ error: 'Selected category does not exist.' });

    let imageUrl: string | undefined;
    if (req.file) {
      try {
        imageUrl = (await uploadImage(req.file.buffer, 'surabhi/menu-items')).url;
      } catch (err) {
        console.error('Menu item image upload failed', err);
        return res.status(502).json({ error: 'Image upload failed. Please try again.' });
      }
    }

    const item = await prisma.menuItem.create({
      data: { ...data, dietaryType: data.dietaryType as never, imageUrl },
      include: listInclude,
    });
    res.status(201).json(item);
  },
);

// PATCH /api/menu-items/:id — full-form update, same convention as outlets.routes.ts.
// A vendor can only ever reach their own item: outletId is forced from the
// verified JWT before the ownership check below runs.
menuItemsRouter.patch(
  '/:id',
  requireAdminOrVendorPermission('MENU'),
  imageUpload.single('image'),
  async (req, res) => {
  const existing = await prisma.menuItem.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Menu item not found' });
  if (req.outletId && existing.outletId !== req.outletId) {
    return res.status(404).json({ error: 'Menu item not found' });
  }

  if (req.outletId) req.body.outletId = req.outletId;
  const { errors, data } = parseBody(req.body ?? {});
  if (errors.length > 0) return res.status(400).json({ error: errors[0], errors });

  if (data.outletId !== existing.outletId) {
    // Diagnostic: an item switching outlets on a plain edit is unexpected
    // enough (it happened unintentionally at least twice) that it's worth a
    // clear trail until the actual trigger is confirmed.
    console.warn(
      `[menu-items] "${existing.name}" (${existing.id}) outlet changing ${existing.outletId} -> ${data.outletId}. ` +
        `Caller: ${req.isSuperAdmin ? 'admin' : `vendor ${req.outletId}`}`,
    );
    const outlet = await prisma.outlet.findUnique({ where: { id: data.outletId } });
    if (!outlet) return res.status(400).json({ error: 'Selected vendor does not exist.' });
  }
  if (data.categoryId !== existing.categoryId) {
    const category = await prisma.category.findUnique({ where: { id: data.categoryId } });
    if (!category) return res.status(400).json({ error: 'Selected category does not exist.' });
  }

  let imageUrl = existing.imageUrl;
  if (req.file) {
    try {
      imageUrl = (await uploadImage(req.file.buffer, 'surabhi/menu-items')).url;
    } catch (err) {
      console.error('Menu item image upload failed', err);
      return res.status(502).json({ error: 'Image upload failed. Please try again.' });
    }
  }

  // Note: MenuItem only stores imageUrl, not an ImageKit fileId, so a replaced
  // photo can't be cleaned up from the media library yet — it just gets
  // orphaned there. Fine for now; revisit if storage cost becomes a concern.
  const item = await prisma.menuItem.update({
    where: { id: existing.id },
    data: { ...data, dietaryType: data.dietaryType as never, imageUrl },
    include: listInclude,
  });

  res.json(item);
});

// PATCH /api/menu-items/:id/availability — quick toggle without resubmitting the whole form
menuItemsRouter.patch('/:id/availability', requireAdminOrVendorPermission('MENU'), async (req, res) => {
  const { isAvailable } = req.body ?? {};
  if (typeof isAvailable !== 'boolean') {
    return res.status(400).json({ error: 'isAvailable must be a boolean.' });
  }
  if (req.outletId) {
    const existing = await prisma.menuItem.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.outletId !== req.outletId) {
      return res.status(404).json({ error: 'Menu item not found' });
    }
  }
  const item = await prisma.menuItem.update({
    where: { id: req.params.id },
    data: { isAvailable },
    include: listInclude,
  });
  res.json(item);
});

// DELETE /api/menu-items/:id — blocked once ordered at least once; deactivate instead.
menuItemsRouter.delete('/:id', requireAdminOrVendorPermission('MENU'), async (req, res) => {
  const item = await prisma.menuItem.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { orderItems: true } } },
  });
  if (!item) return res.status(404).json({ error: 'Menu item not found' });
  if (req.outletId && item.outletId !== req.outletId) {
    return res.status(404).json({ error: 'Menu item not found' });
  }

  if (item._count.orderItems > 0) {
    return res.status(409).json({
      error: 'This item has past orders on record. Mark it unavailable instead of deleting.',
    });
  }

  await prisma.menuItem.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
