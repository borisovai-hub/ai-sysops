import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: `file:${process.env.DB_PATH || '/var/lib/management-ui/management-ui.db'}`,
  },
});
