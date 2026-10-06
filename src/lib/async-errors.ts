import { createRequire } from 'node:module';

// Express 4 only catches errors thrown synchronously. An async route handler
// that rejects (a DB timeout, a Prisma constraint error) would otherwise leave
// the request hanging until the client times out and log an unhandled
// rejection. This patches the single place Express invokes handlers so a
// rejected promise is forwarded to next(err) and reaches the error handler in
// app.ts — the same technique as the `express-async-errors` package.
const require = createRequire(import.meta.url);
const Layer = require('express/lib/router/layer');

type Handler = (req: unknown, res: unknown, next: (err?: unknown) => void) => unknown;

Layer.prototype.handle_request = function handleRequest(
  this: { handle: Handler },
  req: unknown,
  res: unknown,
  next: (err?: unknown) => void,
) {
  const fn = this.handle;
  if (fn.length > 3) return next(); // error-handling middleware, not for this path
  try {
    const result = fn(req, res, next) as { catch?: (cb: (err: unknown) => void) => void } | undefined;
    if (result && typeof result.catch === 'function') result.catch(next);
  } catch (err) {
    next(err);
  }
};
