import express, { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { analyticsLimiter } from '../../lib/rate-limit.js';
import { requireAdminAuth } from '../admin-auth/admin-auth.middleware.js';

export const analyticsRouter = Router();

// ── Collect (public) ─────────────────────────────

const ID_RE = /^[a-z0-9]{8,40}$/i;
const EVENT_NAME_RE = /^[a-z][a-z0-9_]{1,39}$/;
const BOT_RE = /bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|facebookexternalhit|whatsapp|curl|wget|python|axios|node-fetch/i;
const MAX_EVENTS = 25;
const MAX_DURATION_MS = 30 * 60 * 1000;
// Panels have their own traffic patterns and shouldn't inflate customer numbers.
const EXCLUDED_PATH_RE = /^\/(admin|vendor)(\/|$)/;

type IncomingEvent = { t?: unknown; id?: unknown; n?: unknown; p?: unknown; r?: unknown; ms?: unknown };

function deviceFromUA(ua: string): 'mobile' | 'tablet' | 'desktop' {
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android.*Mobile|Opera Mini|IEMobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

function browserFromUA(ua: string): string {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser/.test(ua)) return 'Samsung Internet';
  if (/UCBrowser/.test(ua)) return 'UC Browser';
  if (/Firefox|FxiOS/.test(ua)) return 'Firefox';
  if (/Chrome|CriOS/.test(ua)) return 'Chrome';
  if (/Safari/.test(ua)) return 'Safari';
  return 'Other';
}

function cleanPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  const path = value.split(/[?#]/)[0].slice(0, 300);
  return EXCLUDED_PATH_RE.test(path) ? null : path;
}

// Keep only the referring host — full referrer URLs can carry search terms
// or tokens that have no business sitting in our database.
function referrerHost(value: unknown, ownHost: string | undefined): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const host = new URL(value).hostname.replace(/^www\./, '');
    if (!host || (ownHost && host === ownHost.replace(/^www\./, ''))) return null;
    return host.slice(0, 120);
  } catch {
    return null;
  }
}

// POST /api/analytics/collect — batched beacon from the public website.
// Sent with navigator.sendBeacon as text/plain (no CORS preflight), so the
// body is parsed here rather than by the global express.json().
analyticsRouter.post('/collect', analyticsLimiter, express.text({ type: '*/*', limit: '32kb' }), async (req, res) => {
  // Always 204 — a tracking hiccup is never the visitor's problem, and
  // telling a scraper what we rejected helps nobody.
  res.status(204).end();

  const ua = req.headers['user-agent'] ?? '';
  if (!ua || BOT_RE.test(ua)) return;

  let body: Record<string, unknown>;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return;
  }
  if (!body || typeof body !== 'object') return;

  const visitorId = typeof body.v === 'string' && ID_RE.test(body.v) ? body.v : null;
  const sessionId = typeof body.s === 'string' && ID_RE.test(body.s) ? body.s : null;
  if (!visitorId || !sessionId || !Array.isArray(body.e)) return;

  const device = deviceFromUA(ua);
  const browser = browserFromUA(ua);
  const utmSource = typeof body.u === 'string' && body.u.trim() ? body.u.trim().toLowerCase().slice(0, 60) : null;
  let ownHost: string | undefined;
  try {
    ownHost = req.headers.origin ? new URL(req.headers.origin).hostname : undefined;
  } catch {
    ownHost = undefined;
  }

  const creates: Prisma.AnalyticsEventCreateManyInput[] = [];
  const durations: { id: string; ms: number }[] = [];

  for (const raw of (body.e as IncomingEvent[]).slice(0, MAX_EVENTS)) {
    if (!raw || typeof raw !== 'object') continue;

    if (raw.t === 'leave') {
      if (typeof raw.id === 'string' && ID_RE.test(raw.id) && typeof raw.ms === 'number' && raw.ms > 0) {
        durations.push({ id: raw.id, ms: Math.min(Math.round(raw.ms), MAX_DURATION_MS) });
      }
      continue;
    }

    const path = cleanPath(raw.p);
    if (!path) continue;

    if (raw.t === 'pageview') {
      if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) continue;
      creates.push({
        type: 'pageview',
        pageViewId: raw.id,
        path,
        referrer: referrerHost(raw.r, ownHost),
        visitorId,
        sessionId,
        device,
        browser,
        utmSource,
      });
    } else if (raw.t === 'event' && typeof raw.n === 'string' && EVENT_NAME_RE.test(raw.n)) {
      creates.push({ type: 'event', name: raw.n, path, visitorId, sessionId, device, browser, utmSource });
    }
  }

  try {
    if (creates.length) await prisma.analyticsEvent.createMany({ data: creates, skipDuplicates: true });
    for (const d of durations) {
      // visitorId check stops one visitor from rewriting another's durations.
      await prisma.analyticsEvent.updateMany({
        where: { pageViewId: d.id, visitorId },
        data: { durationMs: d.ms },
      });
    }
  } catch (err) {
    console.error('[analytics] failed to store events', err);
  }
});

// ── Overview (admin) ─────────────────────────────

const IST_OFFSET_MS = 330 * 60 * 1000;
const RANGES = new Set([1, 7, 30, 90]);
const FUNNEL_STEPS = [
  { key: 'visit', label: 'Visited the site' },
  { key: 'station_view', label: 'Opened a station' },
  { key: 'restaurant_view', label: 'Opened a restaurant' },
  { key: 'add_to_cart', label: 'Added to cart' },
  { key: 'checkout_start', label: 'Started checkout' },
  { key: 'order_placed', label: 'Placed an order' },
] as const;

// Midnight IST of the day `daysAgo` days before today, as a UTC Date.
function istDayStart(daysAgo: number): Date {
  const nowIst = Date.now() + IST_OFFSET_MS;
  const dayStartIst = Math.floor(nowIst / 86_400_000) * 86_400_000;
  return new Date(dayStartIst - daysAgo * 86_400_000 - IST_OFFSET_MS);
}

type Totals = { visitors: number; sessions: number; pageviews: number; bounceRate: number; avgSessionSec: number };

async function periodTotals(from: Date, to: Date): Promise<Totals> {
  const [row] = await prisma.$queryRaw<
    { visitors: bigint; sessions: bigint; pageviews: bigint; bounced: bigint; avg_session_ms: number | null }[]
  >(Prisma.sql`
    WITH s AS (
      SELECT "sessionId", "visitorId", COUNT(*) AS views, COALESCE(SUM("durationMs"), 0) AS dur
      FROM "AnalyticsEvent"
      WHERE type = 'pageview' AND "createdAt" >= ${from} AND "createdAt" < ${to}
      GROUP BY "sessionId", "visitorId"
    )
    SELECT
      COUNT(DISTINCT "visitorId") AS visitors,
      COUNT(*) AS sessions,
      COALESCE(SUM(views), 0) AS pageviews,
      COUNT(*) FILTER (WHERE views = 1) AS bounced,
      AVG(dur)::float AS avg_session_ms
    FROM s
  `);
  const sessions = Number(row?.sessions ?? 0);
  return {
    visitors: Number(row?.visitors ?? 0),
    sessions,
    pageviews: Number(row?.pageviews ?? 0),
    bounceRate: sessions ? Math.round((Number(row.bounced) / sessions) * 1000) / 10 : 0,
    avgSessionSec: Math.round((row?.avg_session_ms ?? 0) / 1000),
  };
}

// GET /api/analytics/overview?days=7 — everything the Website Analytics page
// needs in one round trip. Day boundaries are IST midnight.
analyticsRouter.get('/overview', requireAdminAuth, async (req, res) => {
  const requested = Number(req.query.days);
  const days = RANGES.has(requested) ? requested : 7;

  const now = new Date();
  const from = istDayStart(days - 1);
  const prevFrom = istDayStart(days * 2 - 1);
  const liveSince = new Date(Date.now() - 5 * 60 * 1000);
  const range = Prisma.sql`"createdAt" >= ${from} AND "createdAt" < ${now}`;

  const [
    current,
    previous,
    liveRows,
    daily,
    topPages,
    referrers,
    devices,
    browsers,
    hourly,
    funnelRows,
    websiteOrders,
  ] = await Promise.all([
    periodTotals(from, now),
    periodTotals(prevFrom, from),
    prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT "visitorId") AS n FROM "AnalyticsEvent" WHERE "createdAt" >= ${liveSince}
    `),
    prisma.$queryRaw<{ day: string; visitors: bigint; pageviews: bigint }[]>(Prisma.sql`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day,
             COUNT(DISTINCT "visitorId") AS visitors,
             COUNT(*) AS pageviews
      FROM "AnalyticsEvent"
      WHERE type = 'pageview' AND ${range}
      GROUP BY 1 ORDER BY 1
    `),
    prisma.$queryRaw<{ path: string; views: bigint; visitors: bigint; avg_ms: number | null }[]>(Prisma.sql`
      SELECT path, COUNT(*) AS views, COUNT(DISTINCT "visitorId") AS visitors, AVG("durationMs")::float AS avg_ms
      FROM "AnalyticsEvent"
      WHERE type = 'pageview' AND ${range}
      GROUP BY path ORDER BY views DESC LIMIT 10
    `),
    prisma.$queryRaw<{ source: string; visitors: bigint }[]>(Prisma.sql`
      SELECT COALESCE("utmSource", referrer, 'Direct') AS source, COUNT(DISTINCT "visitorId") AS visitors
      FROM "AnalyticsEvent"
      WHERE type = 'pageview' AND ${range}
      GROUP BY 1 ORDER BY visitors DESC LIMIT 8
    `),
    prisma.$queryRaw<{ label: string; visitors: bigint }[]>(Prisma.sql`
      SELECT device AS label, COUNT(DISTINCT "visitorId") AS visitors
      FROM "AnalyticsEvent" WHERE type = 'pageview' AND ${range}
      GROUP BY 1 ORDER BY visitors DESC
    `),
    prisma.$queryRaw<{ label: string; visitors: bigint }[]>(Prisma.sql`
      SELECT COALESCE(browser, 'Other') AS label, COUNT(DISTINCT "visitorId") AS visitors
      FROM "AnalyticsEvent" WHERE type = 'pageview' AND ${range}
      GROUP BY 1 ORDER BY visitors DESC LIMIT 6
    `),
    prisma.$queryRaw<{ hour: number; pageviews: bigint }[]>(Prisma.sql`
      SELECT EXTRACT(HOUR FROM ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::int AS hour,
             COUNT(*) AS pageviews
      FROM "AnalyticsEvent" WHERE type = 'pageview' AND ${range}
      GROUP BY 1 ORDER BY 1
    `),
    prisma.$queryRaw<{ key: string; sessions: bigint }[]>(Prisma.sql`
      SELECT 'visit' AS key, COUNT(DISTINCT "sessionId") AS sessions
      FROM "AnalyticsEvent" WHERE type = 'pageview' AND ${range}
      UNION ALL
      SELECT name AS key, COUNT(DISTINCT "sessionId") AS sessions
      FROM "AnalyticsEvent" WHERE type = 'event' AND ${range}
      GROUP BY name
    `),
    prisma.order.count({ where: { source: 'WEBSITE', createdAt: { gte: from, lt: now } } }),
  ]);

  // Fill gaps so the chart shows a zero day instead of skipping it.
  const dailyMap = new Map(daily.map((d) => [d.day, d]));
  const series = Array.from({ length: days }, (_, i) => {
    const dayStart = istDayStart(days - 1 - i);
    const key = new Date(dayStart.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
    const row = dailyMap.get(key);
    return { date: key, visitors: Number(row?.visitors ?? 0), pageviews: Number(row?.pageviews ?? 0) };
  });

  const hourMap = new Map(hourly.map((h) => [h.hour, Number(h.pageviews)]));
  const funnelMap = new Map(funnelRows.map((f) => [f.key, Number(f.sessions)]));

  const pct = (cur: number, prev: number) =>
    prev === 0 ? (cur > 0 ? null : 0) : Math.round(((cur - prev) / prev) * 1000) / 10;

  res.json({
    days,
    generatedAt: now.toISOString(),
    liveVisitors: Number(liveRows[0]?.n ?? 0),
    totals: current,
    change: {
      visitors: pct(current.visitors, previous.visitors),
      sessions: pct(current.sessions, previous.sessions),
      pageviews: pct(current.pageviews, previous.pageviews),
      bounceRate: previous.sessions ? Math.round((current.bounceRate - previous.bounceRate) * 10) / 10 : null,
      avgSessionSec: pct(current.avgSessionSec, previous.avgSessionSec),
    },
    websiteOrders,
    // Share of sessions that ended in a placed order — measured from tracked
    // sessions only, so orders placed before tracking existed can't skew it.
    conversionRate: current.sessions
      ? Math.min(100, Math.round(((funnelMap.get('order_placed') ?? 0) / current.sessions) * 1000) / 10)
      : 0,
    series,
    hourly: Array.from({ length: 24 }, (_, h) => ({ hour: h, pageviews: hourMap.get(h) ?? 0 })),
    topPages: topPages.map((p) => ({
      path: p.path,
      views: Number(p.views),
      visitors: Number(p.visitors),
      avgSec: p.avg_ms ? Math.round(p.avg_ms / 1000) : null,
    })),
    sources: referrers.map((r) => ({ source: r.source, visitors: Number(r.visitors) })),
    devices: devices.map((d) => ({ label: d.label, visitors: Number(d.visitors) })),
    browsers: browsers.map((b) => ({ label: b.label, visitors: Number(b.visitors) })),
    funnel: FUNNEL_STEPS.map((s) => ({ ...s, sessions: funnelMap.get(s.key) ?? 0 })),
  });
});

// Raw events are only useful for trends — drop anything older than ~13
// months so the table doesn't grow forever. Runs once at boot, then daily.
const RETENTION_DAYS = 400;
export function scheduleAnalyticsCleanup() {
  const run = () =>
    prisma.analyticsEvent
      .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - RETENTION_DAYS * 86_400_000) } } })
      .then((r) => r.count && console.log(`[analytics] pruned ${r.count} old events`))
      .catch((err) => console.error('[analytics] cleanup failed', err));
  run();
  setInterval(run, 24 * 60 * 60 * 1000).unref();
}
