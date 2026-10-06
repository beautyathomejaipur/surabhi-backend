import type { Request } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET!;

// Orders support guest checkout, so a customer token is read if present but
// never required. Anything wrong with the token (expired, tampered, wrong
// role) is treated the same as "no token" rather than rejecting the request
// — a stale token should never block placing an order.
export function getOptionalCustomerId(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as { sub: string; role: string };
    return payload.role === 'CUSTOMER' ? payload.sub : null;
  } catch {
    return null;
  }
}
