import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET!;

export type AdminTokenPayload = {
  sub: 'super-admin';
  role: 'SUPER_ADMIN';
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      isSuperAdmin?: boolean;
    }
  }
}

// Protects every staff-only route (vendors, categories, menu items, stations,
// contact inbox). There is exactly one admin account today (see
// admin-auth.routes.ts), so this only ever checks "is this a valid,
// unexpired admin token" — not which admin, since there is only one.
export function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Sign in required.' });
  }

  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as AdminTokenPayload;
    if (payload.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Not an admin account.' });
    }
    req.isSuperAdmin = true;
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }
}
