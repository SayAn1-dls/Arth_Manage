-- DropForeignKey
ALTER TABLE "Certificate" DROP CONSTRAINT "certificate_member_same_event";

-- DropForeignKey
ALTER TABLE "CertificateException" DROP CONSTRAINT "cert_exception_member_same_event";
