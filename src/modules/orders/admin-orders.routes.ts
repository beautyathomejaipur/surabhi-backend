import { Router } from 'express';
import { Prisma, OrderStatus, PaymentStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { requireAdminAuth } from '../admin-auth/admin-auth.middleware.js';
import { orderDetailSelect, orderListSelect } from './orders.select.js';

export const adminOrdersRouter = Router();

adminOrdersRouter.use(requireAdminAuth);

const STATUS_VALUES = Object.values(OrderStatus);
const PAYMENT_STATUS_VALUES = Object.values(PaymentStatus);

// GET /api/admin/orders — the Orders Management table.
// Query: status, paymentStatus, from, to (ISO dates), q (order no. / name / phone / email / PNR)
adminOrdersRouter.get('/', async (req, res) => {
  const { status, paymentStatus, from, to, q } = req.query;

  const where: Prisma.OrderWhereInput = {};
  if (typeof status === 'string' && STATUS_VALUES.includes(status as OrderStatus)) {
    where.status = status as OrderStatus;
  }
  if (typeof paymentStatus === 'string' && PAYMENT_STATUS_VALUES.includes(paymentStatus as PaymentStatus)) {
    where.paymentStatus = paymentStatus as PaymentStatus;
  }
  if (typeof from === 'string' || typeof to === 'string') {
    where.createdAt = {
      ...(typeof from === 'string' && !Number.isNaN(Date.parse(from)) ? { gte: new Date(from) } : {}),
      ...(typeof to === 'string' && !Number.isNaN(Date.parse(to)) ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
    };
  }
  if (typeof q === 'string' && q.trim()) {
    const term = q.trim();
    where.OR = [
      { orderNumber: { contains: term, mode: 'insensitive' } },
      { customerName: { contains: term, mode: 'insensitive' } },
      { customerPhone: { contains: term } },
      { customerEmail: { contains: term, mode: 'insensitive' } },
      { pnr: { contains: term } },
    ];
  }

  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: orderListSelect,
  });

  res.json(orders);
});

// GET /api/admin/orders/:id — full order detail for the side panel / detail view.
adminOrdersRouter.get('/:id', async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id }, select: orderDetailSelect });
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  res.json(order);
});

// PATCH /api/admin/orders/:id/status
adminOrdersRouter.patch('/:id/status', async (req, res) => {
  const { status, note } = req.body ?? {};
  if (typeof status !== 'string' || !STATUS_VALUES.includes(status as OrderStatus)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }

  const existing = await prisma.order.findUnique({ where: { id: req.params.id }, select: { status: true } });
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

// PATCH /api/admin/orders/:id/payment-status
adminOrdersRouter.patch('/:id/payment-status', async (req, res) => {
  const { paymentStatus } = req.body ?? {};
  if (typeof paymentStatus !== 'string' || !PAYMENT_STATUS_VALUES.includes(paymentStatus as PaymentStatus)) {
    return res.status(400).json({ error: 'Invalid payment status.' });
  }

  const existing = await prisma.order.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!existing) return res.status(404).json({ error: 'Order not found.' });

  const order = await prisma.order.update({
    where: { id: req.params.id },
    data: { paymentStatus: paymentStatus as PaymentStatus },
    select: orderDetailSelect,
  });
  res.json(order);
});
