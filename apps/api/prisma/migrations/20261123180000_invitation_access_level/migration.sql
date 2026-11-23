-- Invitations carry the access level the new member gets on acceptance (UX audit P0-10), so a sponsor
-- viewer, co-admin or staff lead never holds the plain role's full access between accepting and being
-- downgraded. Additive: existing rows default to STANDARD, which is today's behaviour.
-- Rollback: revoke pending non-STANDARD invitations, then ALTER TABLE "Invitation" DROP COLUMN "accessLevel".
ALTER TABLE "Invitation" ADD COLUMN "accessLevel" TEXT NOT NULL DEFAULT 'STANDARD';
