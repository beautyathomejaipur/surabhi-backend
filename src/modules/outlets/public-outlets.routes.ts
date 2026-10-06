import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { withStatus } from '../../lib/outlet-status.js';

export const publicOutletsRouter = Router();

// GET /api/public/outlets — every live restaurant's slug + station, for
// sitemap.ts. Deliberately minimal (no menu, no contact info) since this is
// fetched in bulk at sitemap build time, not per-visitor.
publicOutletsRouter.get('/', async (_req, res) => {
  const outlets = await prisma.outlet.findMany({
    where: { isActive: true, status: 'APPROVED', slug: { not: null } },
    select: {
      slug: true,
      updatedAt: true,
      station: { select: { code: true, name: true } },
    },
    orderBy: { name: 'asc' },
  });
  res.json(outlets);
});

// GET /api/public/outlets/:slug — a single vendor's public storefront page:
// outlet details, its station, and its available menu grouped by category.
// Deliberately a `select`, not the admin outlet shape — never exposes
// passwordHash, contact info, commission, or anything not meant for
// customers. Only live, admin-approved outlets are ever returned.
publicOutletsRouter.get('/:slug', async (req, res) => {
  const outlet = await prisma.outlet.findFirst({
    where: { slug: req.params.slug, isActive: true, status: 'APPROVED' },
    select: {
      id: true,
      name: true,
      slug: true,
      imageUrl: true,
      description: true,
      foodTypes: true,
      minOrderValue: true,
      minOrderTimeMins: true,
      workingHoursStart: true,
      workingHoursEnd: true,
      weeklyOff: true,
      availability: true,
      station: { select: { id: true, code: true, name: true, state: true } },
      menuItems: {
        where: { isAvailable: true },
        select: {
          id: true,
          name: true,
          description: true,
          imageUrl: true,
          price: true,
          discountPercent: true,
          dietaryType: true,
          category: { select: { id: true, name: true, displayOrder: true } },
        },
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      },
    },
  });
  if (!outlet) return res.status(404).json({ error: 'Restaurant not found' });
  res.json(withStatus(outlet));
});
