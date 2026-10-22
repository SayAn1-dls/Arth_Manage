-- Baseline: extensions the domain schema relies on (see docs/TECHNICAL_ARCHITECTURE.md §6).
-- citext: case-insensitive unique emails. pgcrypto: gen_random_uuid() for database-side ids if needed.
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
