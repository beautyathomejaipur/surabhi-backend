import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { generateOrderNumber } from '../../lib/order-number.js';
import { getOptionalCustomerId } from '../../lib/optional-customer.js';
import { orderDetailSelect, orderListSelect } from './orders.select.js';

export const ordersRouter = Router();

const PNR_RE = /^\d{10}$/;
const TRAIN_NO_RE = /^\d{5}$/;
const PHONE_RE = /^[6-9]\d{9}$/;

// POST /api/orders — place an order (guest checkout allowed; a signed-in
// customer's token, if present, links the order to their account).
// All pricing is recomputed here from the live menu-item rows — the cart
// totals shown on the website are never trusted as-is, only as a shopping list.
ordersRouter.post('/', async (req, res) => {
  const body = req.body ?? {};
  const customerId = getOptionalCustomerId(req);

  const {
    outletId,
    customerName,
    customerPhone,
    customerEmail,
    pnr,
    trainNumber,
    journeyDate,
    coach,
    seat,
    deliveryInstructions,
    paymentMode,
    items,
  } = body;

  if (typeof outletId !== 'string' || !outletId) {
    return res.status(400).json({ error: 'Missing outlet.' });
  }
  if (typeof customerName !== 'string' || customerName.trim().length < 2) {
    return res.status(400).json({ error: "Enter the passenger's name." });
  }
  if (typeof customerPhone !== 'string' || !PHONE_RE.test(customerPhone.trim())) {
    return res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
  }
  if (typeof pnr !== 'string' || !PNR_RE.test(pnr.trim())) {
    return res.status(400).json({ error: 'PNR must be a 10-digit number.' });
  }
  if (trainNumber && !TRAIN_NO_RE.test(String(trainNumber).trim())) {
    return res.status(400).json({ error: 'Train number must be 5 digits.' });
  }
  if (!journeyDate || Number.isNaN(Date.parse(journeyDate))) {
    return res.status(400).json({ error: 'Pick a valid journey date.' });
  }
  if (typeof coach !== 'string' || !coach.trim()) {
    return res.status(400).json({ error: 'Enter the coach.' });
  }
  if (typeof seat !== 'string' || !seat.trim()) {
    return res.status(400).json({ error: 'Enter the seat or berth number.' });
  }
  if (paymentMode !== 'COD' && paymentMode !== 'ONLINE') {
    return res.status(400).json({ error: 'Choose a payment method.' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Your cart is empty.' });
  }

  const outlet = await prisma.outlet.findUnique({ where: { id: outletId } });
  if (!outlet || !outlet.isActive || outlet.status !== 'APPROVED') {
    return res.status(404).json({ error: "This restaurant isn't taking orders right now." });
  }

  const quantityByItemId = new Map<string, number>();
  const noteByItemId = new Map<string, string>();
  for (const raw of items) {
    const menuItemId = raw?.menuItemId;
    const quantity = Number(raw?.quantity);
    if (typeof menuItemId !== 'string' || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      return res.status(400).json({ error: 'One of the items in your cart looks invalid.' });
    }
    quantityByItemId.set(menuItemId, (quantityByItemId.get(menuItemId) ?? 0) + quantity);
    if (typeof raw?.note === 'string' && raw.note.trim()) noteByItemId.set(menuItemId, raw.note.trim());
  }

  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: [...quantityByItemId.keys()] }, outletId, isAvailable: true },
  });
  if (menuItems.length !== quantityByItemId.size) {
    return res.status(409).json({
      error: 'One or more dishes in your cart are no longer available. Please review your cart and try again.',
    });
  }

  let subtotal = 0;
  let discountAmount = 0;
  let gstAmount = 0;
  const orderItemsData = menuItems.map((item) => {
    const quantity = quantityByItemId.get(item.id)!;
    const price = Number(item.price);
    const discountPercent = Number(item.discountPercent);
    const taxPercent = Number(item.taxPercent);
    const lineListTotal = price * quantity;
    const lineDiscount = (lineListTotal * discountPercent) / 100;
    const lineNet = lineListTotal - lineDiscount;
    const lineTax = (lineNet * taxPercent) / 100;

    subtotal += lineListTotal;
    discountAmount += lineDiscount;
    gstAmount += lineTax;

    return {
      menuItemId: item.id,
      nameSnapshot: item.name,
      priceSnapshot: item.price,
      taxPercent: item.taxPercent,
      quantity,
      lineTotal: Math.round((lineNet + lineTax) * 100) / 100,
      note: noteByItemId.get(item.id),
    };
  });

  const netItemTotal = subtotal - discountAmount;
  if (netItemTotal < Number(outlet.minOrderValue)) {
    return res.status(400).json({
      error: `This restaurant's minimum order value is ₹${outlet.minOrderValue}. Add a few more items.`,
    });
  }

  const deliveryCharge = Number(outlet.deliveryCharge);
  const totalAmount = netItemTotal + gstAmount + deliveryCharge;

  let order;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      order = await prisma.order.create({
        data: {
          orderNumber: generateOrderNumber(),
          customerId: customerId ?? undefined,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          customerEmail: typeof customerEmail === 'string' && customerEmail.trim() ? customerEmail.trim() : undefined,
          pnr: pnr.trim(),
          trainNumber: trainNumber ? String(trainNumber).trim() : undefined,
          journeyDate: new Date(journeyDate),
          coach: coach.trim().toUpperCase(),
          berth: seat.trim(),
          deliveryStationId: outlet.stationId,
          outletId: outlet.id,
          subtotal: Math.round(subtotal * 100) / 100,
          discountAmount: Math.round(discountAmount * 100) / 100,
          deliveryCharge,
          gstAmount: Math.round(gstAmount * 100) / 100,
          totalAmount: Math.round(totalAmount * 100) / 100,
          paymentMode,
          paymentStatus: 'PENDING',
          status: 'PENDING',
          source: 'WEBSITE',
          deliveryInstructions: typeof deliveryInstructions === 'string' ? deliveryInstructions.trim() || undefined : undefined,
          items: { create: orderItemsData },
          statusLogs: { create: { toStatus: 'PENDING' } },
        },
        select: orderDetailSelect,
      });
      break;
    } catch (err) {
      const isUniqueClash = (err as { code?: string })?.code === 'P2002';
      if (!isUniqueClash || attempt === 2) throw err;
    }
  }

  res.status(201).json(order);
});

// GET /api/orders/mine — the signed-in customer's own order history.
ordersRouter.get('/mine', async (req, res) => {
  const customerId = getOptionalCustomerId(req);
  if (!customerId) return res.status(401).json({ error: 'Sign in required.' });

  const orders = await prisma.order.findMany({
    where: { customerId },
    orderBy: { createdAt: 'desc' },
    select: orderListSelect,
  });
  res.json(orders);
});

// GET /api/orders/:id — order confirmation / tracking view. The id is an
// unguessable cuid, which is enough entropy for a shareable confirmation
// link (same pattern most food-delivery sites use), so no auth is required.
ordersRouter.get('/:id', async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id }, select: orderDetailSelect });
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  res.json(order);
});
