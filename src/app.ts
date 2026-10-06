import './lib/async-errors.js';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { stationsRouter } from './modules/stations/stations.routes.js';
import { outletsRouter } from './modules/outlets/outlets.routes.js';
import { publicOutletsRouter } from './modules/outlets/public-outlets.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { adminAuthRouter } from './modules/admin-auth/admin-auth.routes.js';
import { vendorAuthRouter } from './modules/vendor-auth/vendor-auth.routes.js';
import { categoriesRouter } from './modules/categories/categories.routes.js';
import { menuItemsRouter } from './modules/menu-items/menu-items.routes.js';
import { contactRouter } from './modules/contact/contact.routes.js';
import { ordersRouter } from './modules/orders/orders.routes.js';
import { adminOrdersRouter } from './modules/orders/admin-orders.routes.js';
import { vendorOrdersRouter } from './modules/orders/vendor-orders.routes.js';
import { vendorRequestsRouter } from './modules/vendor-requests/vendor-requests.routes.js';
import { analyticsRouter } from './modules/analytics/analytics.routes.js';
import { adminDashboardRouter } from './modules/admin-dashboard/admin-dashboard.routes.js';
import { prisma } from './lib/prisma.js';

export const app = express();

app.disable('x-powered-by');

// Behind a reverse proxy (Nginx, Render, Railway…) set TRUST_PROXY=1 so the
// rate limiters see the visitor's IP instead of the proxy's.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
}

// CORS_ORIGINS="https://surabhicatering.com,https://www.surabhicatering.com"
// locks the API to the real site in production. Unset = allow all (local dev).
const allowedOrigins = process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors(allowedOrigins?.length ? { origin: allowedOrigins } : undefined));
app.use(express.json({ limit: '1mb' }));

app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'degraded', database: 'disconnected' });
  }
});

app.use('/api/stations', stationsRouter);
app.use('/api/public/outlets', publicOutletsRouter);
app.use('/api/outlets', outletsRouter);
app.use('/api/auth', authRouter);
app.use('/api/admin-auth', adminAuthRouter);
app.use('/api/vendor-auth', vendorAuthRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/menu-items', menuItemsRouter);
app.use('/api/contact', contactRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/admin/orders', adminOrdersRouter);
app.use('/api/admin/dashboard', adminDashboardRouter);
app.use('/api/vendor/orders', vendorOrdersRouter);
app.use('/api/vendor-requests', vendorRequestsRouter);
app.use('/api/analytics', analyticsRouter);

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Multer (file upload) errors — bad mime type, oversized file — surface as 400s
// instead of the default 500 crash-shaped response.
app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err instanceof Error && err.message.includes('Only JPEG, PNG or WebP')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

// Last stop for anything unexpected. The real error goes to the server log;
// the client only ever sees a calm, generic message — never a stack trace.
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = (err as { status?: number; statusCode?: number })?.status ?? (err as { statusCode?: number })?.statusCode;
  if (status && status >= 400 && status < 500) {
    // body-parser errors (malformed JSON, payload too large) carry their own 4xx.
    return res.status(status).json({ error: status === 413 ? 'That upload is too large.' : 'Invalid request.' });
  }
  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Something went wrong on our side. Please try again in a moment.' });
});
