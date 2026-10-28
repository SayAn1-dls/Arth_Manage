-- Restores two integrity rules that 20261023150259_first_migration dropped by accident.
-- Prisma does not model these composite keys in schema.prisma, so `prisma migrate dev` keeps proposing to drop
-- them; review any generated migration for DROP CONSTRAINT lines before committing it.
-- A certificate or certificate exception must reference a membership of the SAME event.
-- Drop first so the migration is safe on databases that never lost them.
ALTER TABLE "Certificate" DROP CONSTRAINT IF EXISTS certificate_member_same_event;
ALTER TABLE "Certificate" ADD CONSTRAINT certificate_member_same_event
  FOREIGN KEY ("membershipId", "eventId") REFERENCES "EventMembership" (id, "eventId") ON DELETE CASCADE;

ALTER TABLE "CertificateException" DROP CONSTRAINT IF EXISTS cert_exception_member_same_event;
ALTER TABLE "CertificateException" ADD CONSTRAINT cert_exception_member_same_event
  FOREIGN KEY ("membershipId", "eventId") REFERENCES "EventMembership" (id, "eventId") ON DELETE CASCADE;
