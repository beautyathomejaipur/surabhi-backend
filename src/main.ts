import 'dotenv/config';
import { app } from './app.js';
import { prisma } from './lib/prisma.js';
import { scheduleAnalyticsCleanup } from './modules/analytics/analytics.routes.js';

const port = process.env.PORT ?? 3001;

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

async function main() {
  await prisma.$connect();
  console.log('✅ Database connected (surabhi_db)');

  const server = app.listen(port, () => {
    console.log(`Surabhi backend listening on http://localhost:${port}`);
  });

  scheduleAnalyticsCleanup();

  // Let in-flight requests finish on deploy/restart instead of cutting them off.
  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down…`);
    server.close(() => {
      prisma.$disconnect().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('❌ Failed to connect to database:', err.message);
  process.exit(1);
});
