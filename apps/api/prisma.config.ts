import { loadEnvFile } from 'node:process';
import { defineConfig } from 'prisma/config';

// Prisma 7 reads the connection string here rather than from schema.prisma.
try {
  loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // No .env file: rely on variables already present in the environment (CI, production).
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
