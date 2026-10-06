import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { imageUpload } from '../../lib/upload.js';
import { uploadImage, deleteImage } from '../../lib/imagekit.js';
import { slugify } from '../../lib/slugify.js';
import { requireAdminAuth } from '../admin-auth/admin-auth.middleware.js';
import { requireAdminOrVendorPermission } from '../vendor-auth/vendor-auth.middleware.js';

export const categoriesRouter = Router();

async function uniqueSlug(name: string, excludeId?: string): Promise<string> {
  const base = slugify(name) || 'category';
  let slug = base;
  let suffix = 2;
  while (
    await prisma.category.findFirst({
      where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    })
  ) {
    slug = `${base}-${suffix++}`;
  }
  return slug;
}

// GET /api/categories — list, newest-first within display order.
// ?active=true restricts to active categories (used by the public menu browser).
categoriesRouter.get('/', async (req, res) => {
  const { active } = req.query;
  const categories = await prisma.category.findMany({
    where: active === 'true' ? { isActive: true } : undefined,
    include: { _count: { select: { menuItems: true } } },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
  });
  res.json(categories);
});

// GET /api/categories/:id
categoriesRouter.get('/:id', async (req, res) => {
  const category = await prisma.category.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { menuItems: true } } },
  });
  if (!category) return res.status(404).json({ error: 'Category not found' });
  res.json(category);
});

// POST /api/categories — multipart/form-data: name (required), displayOrder?, image?
// Admin can always create one; a vendor can only if granted the CATEGORY
// permission — the category is still platform-wide once created (there's no
// per-outlet ownership on Category), so this is a deliberate trust grant,
// not a scoped one like menu items.
categoriesRouter.post(
  '/',
  requireAdminOrVendorPermission('CATEGORY'),
  imageUpload.single('image'),
  async (req, res) => {
  const { name, displayOrder } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  let thumbnailUrl: string | undefined;
  let thumbnailPublicId: string | undefined;
  if (req.file) {
    try {
      const uploaded = await uploadImage(req.file.buffer, 'surabhi/categories', 'thumbnail');
      thumbnailUrl = uploaded.url;
      thumbnailPublicId = uploaded.publicId;
    } catch (err) {
      console.error('Category image upload failed', err);
      return res.status(502).json({ error: 'Image upload failed. Please try again.' });
    }
  }

  const slug = await uniqueSlug(name);
  const category = await prisma.category.create({
    data: {
      name: name.trim(),
      slug,
      thumbnailUrl,
      thumbnailPublicId,
      displayOrder: displayOrder ? Number(displayOrder) : 0,
    },
    include: { _count: { select: { menuItems: true } } },
  });
  res.status(201).json(category);
});

// PATCH /api/categories/:id — partial update; a new image replaces (and deletes) the old one.
categoriesRouter.patch('/:id', requireAdminAuth, imageUpload.single('image'), async (req, res) => {
  const existing = await prisma.category.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Category not found' });

  const { name, displayOrder, isActive } = req.body ?? {};

  let thumbnailUrl = existing.thumbnailUrl;
  let thumbnailPublicId = existing.thumbnailPublicId;
  if (req.file) {
    try {
      const uploaded = await uploadImage(req.file.buffer, 'surabhi/categories', 'thumbnail');
      thumbnailUrl = uploaded.url;
      thumbnailPublicId = uploaded.publicId;
    } catch (err) {
      console.error('Category image upload failed', err);
      return res.status(502).json({ error: 'Image upload failed. Please try again.' });
    }
  }

  const category = await prisma.category.update({
    where: { id: req.params.id },
    data: {
      name: typeof name === 'string' && name.trim() ? name.trim() : undefined,
      slug: typeof name === 'string' && name.trim() ? await uniqueSlug(name, existing.id) : undefined,
      displayOrder: displayOrder !== undefined ? Number(displayOrder) : undefined,
      isActive: isActive !== undefined ? isActive === 'true' || isActive === true : undefined,
      thumbnailUrl,
      thumbnailPublicId,
    },
    include: { _count: { select: { menuItems: true } } },
  });

  if (req.file && existing.thumbnailPublicId) {
    deleteImage(existing.thumbnailPublicId).catch(() => {});
  }

  res.json(category);
});

// DELETE /api/categories/:id — blocked while menu items still reference it;
// deactivate (PATCH isActive=false) instead of deleting in that case.
categoriesRouter.delete('/:id', requireAdminAuth, async (req, res) => {
  const category = await prisma.category.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { menuItems: true } } },
  });
  if (!category) return res.status(404).json({ error: 'Category not found' });

  if (category._count.menuItems > 0) {
    return res.status(409).json({
      error: `${category._count.menuItems} menu item(s) still use this category. Deactivate it instead of deleting, or move those items first.`,
    });
  }

  await prisma.category.delete({ where: { id: req.params.id } });
  if (category.thumbnailPublicId) {
    deleteImage(category.thumbnailPublicId).catch(() => {});
  }
  res.status(204).send();
});
