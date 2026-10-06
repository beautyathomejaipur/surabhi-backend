import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { requireAdminAuth } from '../admin-auth/admin-auth.middleware.js';

export const adminDashboardRouter = Router();

adminDashboardRouter.use(requireAdminAuth);

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 86_400_000;

function istDayStart(daysAgo: number): Date {
  const nowIst = Date.now() + IST_OFFSET_MS;
  return new Date(Math.floor(nowIst / DAY_MS) * DAY_MS - daysAgo * DAY_MS - IST_OFFSET_MS);
}

function pctChange(cur: number, prev: number): number | null {
  if (prev === 0) return cur > 0 ? null : 0;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

// Revenue excludes cancelled/incomplete orders — money that never changed hands.
const REVENUE_WHERE: Prisma.OrderWhereInput = { status: { notIn: ['CANCELLED', 'INCOMPLETE'] } };

// GET /api/admin/dashboard — real numbers for the Dashboard page, one call.
adminDashboardRouter.get('/', async (req, res) => {
  const todayStart = istDayStart(0);
  const yesterdayStart = istDayStart(1);
  const weekStart = istDayStart(6);
  const monthStart = istDayStart(29);
  const now = new Date();
  // Same clock time yesterday, so "vs yesterday" compares like with like
  // instead of a partial today against a full yesterday.
  const yesterdaySameTime = new Date(now.getTime() - DAY_MS);

  const [
    todayOrders,
    yesterdayOrders,
    todayRevenue,
    yesterdayRevenue,
    activeOutlets,
    totalOutlets,
    pendingRequests,
    requestsThisWeek,
    needsAction,
    weekly,
    paymentSplit,
    statusSplit,
    recentOrders,
    topOutletRows,
    latestRequests,
    visitorsToday,
  ] = await Promise.all([
    prisma.order.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.order.count({ where: { createdAt: { gte: yesterdayStart, lt: yesterdaySameTime } } }),
    prisma.order.aggregate({ _sum: { totalAmount: true }, where: { ...REVENUE_WHERE, createdAt: { gte: todayStart } } }),
    prisma.order.aggregate({
      _sum: { totalAmount: true },
      where: { ...REVENUE_WHERE, createdAt: { gte: yesterdayStart, lt: yesterdaySameTime } },
    }),
    prisma.outlet.count({ where: { isActive: true, status: 'APPROVED' } }),
    prisma.outlet.count(),
    prisma.vendorRequest.count({ where: { status: 'NEW' } }),
    prisma.vendorRequest.count({ where: { createdAt: { gte: weekStart } } }),
    prisma.order.count({ where: { status: 'PENDING' } }),
    prisma.$queryRaw<{ day: string; orders: bigint; revenue: Prisma.Decimal | null }[]>(Prisma.sql`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day,
             COUNT(*) AS orders,
             SUM("totalAmount") FILTER (WHERE status NOT IN ('CANCELLED', 'INCOMPLETE')) AS revenue
      FROM "Order"
      WHERE "createdAt" >= ${weekStart}
      GROUP BY 1 ORDER BY 1
    `),
    prisma.order.groupBy({ by: ['paymentMode'], _count: { _all: true }, where: { createdAt: { gte: monthStart } } }),
    prisma.order.groupBy({ by: ['status'], _count: { _all: true }, where: { createdAt: { gte: monthStart } } }),
    prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: {
        id: true,
        orderNumber: true,
        customerName: true,
        totalAmount: true,
        paymentMode: true,
        status: true,
        createdAt: true,
        deliveryStation: { select: { name: true, code: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.order.groupBy({
      by: ['outletId'],
      _count: { _all: true },
      _sum: { totalAmount: true },
      where: { ...REVENUE_WHERE, createdAt: { gte: monthStart } },
      orderBy: { _count: { outletId: 'desc' } },
      take: 5,
    }),
    prisma.vendorRequest.findMany({
      where: { status: 'NEW' },
      orderBy: { createdAt: 'desc' },
      take: 4,
      select: { id: true, restaurantName: true, stationName: true, city: true, createdAt: true },
    }),
    prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT "visitorId") AS n FROM "AnalyticsEvent"
      WHERE type = 'pageview' AND "createdAt" >= ${todayStart}
    `),
  ]);

  const outletInfo = topOutletRows.length
    ? await prisma.outlet.findMany({
        where: { id: { in: topOutletRows.map((r) => r.outletId) } },
        select: { id: true, name: true, station: { select: { name: true, code: true } } },
      })
    : [];
  const outletById = new Map(outletInfo.map((o) => [o.id, o]));

  const weeklyMap = new Map(weekly.map((w) => [w.day, w]));
  const weeklySeries = Array.from({ length: 7 }, (_, i) => {
    const start = istDayStart(6 - i);
    const key = new Date(start.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
    const row = weeklyMap.get(key);
    return { date: key, orders: Number(row?.orders ?? 0), revenue: Number(row?.revenue ?? 0) };
  });

  const statusCounts = Object.fromEntries(statusSplit.map((s) => [s.status, s._count._all]));
  const delivered = statusCounts.DELIVERED ?? 0;
  const cancelled = statusCounts.CANCELLED ?? 0;

  const todayRev = Number(todayRevenue._sum.totalAmount ?? 0);
  const yRev = Number(yesterdayRevenue._sum.totalAmount ?? 0);

  res.json({
    generatedAt: now.toISOString(),
    stats: {
      todayOrders,
      todayOrdersChange: pctChange(todayOrders, yesterdayOrders),
      todayRevenue: todayRev,
      todayRevenueChange: pctChange(todayRev, yRev),
      activeOutlets,
      totalOutlets,
      pendingRequests,
      requestsThisWeek,
      needsAction,
      visitorsToday: Number(visitorsToday[0]?.n ?? 0),
    },
    weekly: weeklySeries,
    paymentSplit: {
      COD: paymentSplit.find((p) => p.paymentMode === 'COD')?._count._all ?? 0,
      ONLINE: paymentSplit.find((p) => p.paymentMode === 'ONLINE')?._count._all ?? 0,
    },
    fulfilment: {
      delivered,
      cancelled,
      successRate: delivered + cancelled ? Math.round((delivered / (delivered + cancelled)) * 1000) / 10 : null,
    },
    recentOrders: recentOrders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customerName,
      station: o.deliveryStation.name,
      items: o._count.items,
      totalAmount: o.totalAmount.toString(),
      paymentMode: o.paymentMode,
      status: o.status,
      createdAt: o.createdAt,
    })),
    topOutlets: topOutletRows.map((r) => {
      const info = outletById.get(r.outletId);
      return {
        id: r.outletId,
        name: info?.name ?? 'Removed outlet',
        station: info ? `${info.station.name} (${info.station.code})` : '',
        orders: r._count._all,
        revenue: Number(r._sum.totalAmount ?? 0),
      };
    }),
    latestRequests,
  });
});

// GET /api/admin/dashboard/counts — tiny payload for the sidebar badge and
// topbar bell, polled every minute while the panel is open.
adminDashboardRouter.get('/counts', async (req, res) => {
  const [pendingOrders, newVendorRequests, newInquiries] = await Promise.all([
    prisma.order.count({ where: { status: 'PENDING' } }),
    prisma.vendorRequest.count({ where: { status: 'NEW' } }),
    prisma.contactInquiry.count({ where: { status: 'NEW' } }),
  ]);
  res.json({ pendingOrders, newVendorRequests, newInquiries });
});
