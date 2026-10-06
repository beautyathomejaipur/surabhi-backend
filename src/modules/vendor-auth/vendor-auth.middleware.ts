import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../../lib/prisma.js';

const JWT_SECRET = process.env.JWT_SECRET!;

export type VendorModule = 'MENU' | 'CATEGORY';

export type VendorTokenPayload = {
  sub: string; // Outlet id
  role: 'VENDOR';
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      outletId?: string;
    }
  }
}

// Protects vendor-panel routes: every vendor JWT is scoped to exactly one
// outletId, so a vendor can never read or write another outlet's data just
// by knowing/guessing its id — the middleware, not the route body, decides
// which outlet a request is allowed to touch.
export function requireVendorAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Sign in required.' });
  }

  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as VendorTokenPayload;
    if (payload.role !== 'VENDOR') {
      return res.status(403).json({ error: 'Not a vendor account.' });
    }
    req.outletId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }
}

// Shared write routes (menu items, categories) accept either the one admin
// account, or a vendor whose outlet has been granted this module. Vendor
// writes are then scoped to req.outletId by the route handler itself — this
// middleware only decides who gets past the door.
export function requireAdminOrVendorPermission(module: VendorModule) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Sign in required.' });
    }

    let payload: { sub: string; role: string };
    try {
      payload = jwt.verify(header.slice(7), JWT_SECRET) as typeof payload;
    } catch {
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }

    if (payload.role === 'SUPER_ADMIN') {
      req.isSuperAdmin = true;
      return next();
    }

    if (payload.role === 'VENDOR') {
      req.outletId = payload.sub;
      const grant = await prisma.outletPermission.findUnique({
        where: { outletId_module: { outletId: payload.sub, module } },
      });
      if (!grant) {
        return res.status(403).json({
          error: `You don't have access to manage ${module.toLowerCase()} yet. Ask your account manager to grant it.`,
        });
      }
      return next();
    }

    return res.status(403).json({ error: 'Not authorized.' });
  };
}

// Gate a route on a permission Super Admin granted this outlet — checked
// fresh against the database on every request (not baked into the JWT), so
// revoking access takes effect immediately without forcing a re-login.
// Must run after requireVendorAuth (needs req.outletId already set).
export function requireVendorPermission(module: VendorModule) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.outletId) {
      return res.status(401).json({ error: 'Sign in required.' });
    }
    const grant = await prisma.outletPermission.findUnique({
      where: { outletId_module: { outletId: req.outletId, module } },
    });
    if (!grant) {
      return res.status(403).json({
        error: `You don't have access to manage ${module.toLowerCase()} yet. Ask your account manager to grant it.`,
      });
    }
    next();
  };
}
