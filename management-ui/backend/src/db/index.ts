import { drizzle } from 'drizzle-orm/libsql';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

type DbInstance = ReturnType<typeof drizzle<typeof schema>>;

let db: DbInstance;
let client: Client;

export function getDb(): DbInstance {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

/**
 * Resolve migrations folder — works in both dev (src/) and prod (dist/).
 */
function getMigrationsFolder(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  // Dev: currentDir = .../backend/src/db/ → migrations at ./migrations/
  const local = resolve(currentDir, 'migrations');
  if (existsSync(local)) return local;
  // Prod: currentDir = .../backend/dist/db/ → migrations at ../../src/db/migrations/
  return resolve(currentDir, '..', '..', 'src', 'db', 'migrations');
}

/**
 * Handle existing databases created before Drizzle migrations.
 * If app tables exist but __drizzle_migrations doesn't, seed the migration
 * tracking so the initial migration (0000) is skipped.
 */
async function seedMigrationState(c: Client): Promise<void> {
  const result = await c.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'",
  );
  if (result.rows.length > 0) return; // already tracked

  const tables = await c.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='auth_tokens'",
  );
  if (tables.rows.length === 0) return; // fresh DB — let migrate() create everything

  // Existing DB without tracking — mark initial migration as applied
  await c.execute(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at INTEGER
    )
  `);
  await c.execute({
    sql: 'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
    args: ['0000_ordinary_stardust', Date.now()],
  });
}

export async function initDb(dbPath: string): Promise<DbInstance> {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  client = createClient({
    url: `file:${dbPath}`,
  });

  await client.execute('PRAGMA journal_mode = WAL');
  await client.execute('PRAGMA foreign_keys = ON');

  db = drizzle(client, { schema });

  // Handle pre-migration databases
  await seedMigrationState(client);

  // Run Drizzle migrations (idempotent — skips already applied)
  await migrate(db, { migrationsFolder: getMigrationsFolder() });

  return db;
}

export async function closeDb(): Promise<void> {
  if (client) {
    client.close();
  }
}
