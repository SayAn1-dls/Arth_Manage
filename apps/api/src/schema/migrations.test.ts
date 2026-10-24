import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestKit } from '../test/helpers.js';

const { db } = createTestKit();
afterAll(() => db.$disconnect());

const dir = fileURLToPath(new URL('../../prisma/migrations/', import.meta.url));
const migrations = readdirSync(dir)
  .filter((d) => /^\d{14}_/.test(d))
  .sort()
  .map((d) => ({ name: d, sql: readFileSync(`${dir}${d}/migration.sql`, 'utf8') }));

describe('migrations', () => {
  it('apply in the order they were written (names sort by creation, none depends on a later one)', async () => {
    // Every table a migration alters or drops constraints from must already be created by an earlier migration.
    const created = new Set<string>();
    for (const m of migrations) {
      for (const t of m.sql.matchAll(/CREATE TABLE "(\w+)"/g)) created.add(t[1]!);
      for (const t of m.sql.matchAll(/ALTER TABLE "(\w+)"/g))
        expect(created.has(t[1]!), `${m.name} alters ${t[1]} before it exists`).toBe(true);
    }
  });

  it('keeps every hand-written integrity rule (triggers, checks, partial and composite constraints) in the database', async () => {
    const all = migrations.map((m) => m.sql).join('\n');
    const dropped = new Set(
      [...all.matchAll(/DROP (?:TRIGGER|INDEX|CONSTRAINT)(?: IF EXISTS)? "?(\w+)"?/g)].map(
        (m) => m[1]!,
      ),
    );
    const expected = new Set<string>();
    for (const m of all.matchAll(/CREATE (?:OR REPLACE )?TRIGGER "?(\w+)"?/g))
      expected.add(`trigger:${m[1]}`);
    for (const m of all.matchAll(
      /ADD CONSTRAINT "?([a-z_][\w]*)"?\s+(?:CHECK|FOREIGN KEY|UNIQUE|EXCLUDE)/g,
    ))
      expected.add(`constraint:${m[1]}`);
    for (const m of all.matchAll(/CREATE UNIQUE INDEX "?(\w+)"?[^;]*\bWHERE\b/g))
      expected.add(`index:${m[1]}`);
    expect(expected.size).toBeGreaterThan(20);

    const rows = await db.$queryRaw<{ n: string }[]>`
      SELECT 'trigger:' || tgname AS n FROM pg_trigger WHERE NOT tgisinternal
      UNION ALL SELECT 'constraint:' || conname FROM pg_constraint
      UNION ALL SELECT 'index:' || indexname FROM pg_indexes WHERE schemaname = 'public'`;
    const present = new Set(rows.map((r) => r.n));
    const missing = [...expected].filter((e) => !dropped.has(e.split(':')[1]!) && !present.has(e));
    expect(missing).toEqual([]);
  });
});
