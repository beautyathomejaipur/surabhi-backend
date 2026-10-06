import { Router } from 'express';
import { OrderStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { requireVendorAuth } from '../vendor-auth/vendor-auth.middleware.js';
import { orderDetailSelect, orderListSelect } from './orders.select.js';

export const vendorOrdersRouter = Router();

vendorOrdersRouter.use(requireVendorAuth);

const STATUS_VALUES = Object.values(OrderStatus);

// Vendors change the kitchen/delivery status of their own orders, never the
// money side — payment status stays admin-only (see admin-orders.routes.ts).
// req.outletId comes only from the verified JWT, never from the request body,
// so one vendor can't read or touch another outlet's orders by guessing an id.

// GET /api/vendor/orders — this outlet's orders only.
vendorOrdersRouter.get('/', async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { outletId: req.outletId },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: orderListSelect,
  });
  res.json(orders);
});

// GET /api/vendor/orders/:id
vendorOrdersRouter.get('/:id', async (req, res) => {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, outletId: req.outletId },
    select: orderDetailSelect,
  });
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  res.json(order);
});

// PATCH /api/vendor/orders/:id/status
vendorOrdersRouter.patch('/:id/status', async (req, res) => {
  const { status, note } = req.body ?? {};
  if (typeof status !== 'string' || !STATUS_VALUES.includes(status as OrderStatus)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }

  const existing = await prisma.order.findFirst({
    where: { id: req.params.id, outletId: req.outletId },
    select: { status: true },
  });
  if (!existing) return res.status(404).json({ error: 'Order not found.' });

  const order = await prisma.order.update({
    where: { id: req.params.id },
    data: {
      status: status as OrderStatus,
      statusLogs: {
        create: {
          fromStatus: existing.status,
          toStatus: status as OrderStatus,
          note: typeof note === 'string' && note.trim() ? note.trim() : undefined,
        },
      },
    },
    select: orderDetailSelect,
  });
  res.json(order);
});
