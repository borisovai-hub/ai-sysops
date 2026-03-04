import { buildApp } from './app.js';
import { getPort, getDbPath } from './config/env.js';
import { initDb, closeDb } from './db/index.js';
import { monitoringService } from './services/monitoring.service.js';

async function main() {
  const port = getPort();
  const dbPath = getDbPath();

  await initDb(dbPath);

  const app = await buildApp({ logger: true, dbPath });

  // Start monitoring (if enabled in config)
  monitoringService.start();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down...`);
    monitoringService.stop();
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  try {
    await app.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
