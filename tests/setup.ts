/**
 * Test setup. Loads `.env` (if present) so live sandbox tests pick up the
 * Assinafy credentials, and exposes a few helpers used across suites.
 */
import "dotenv/config";

export interface TestEnv {
  baseUrl: string;
  apiKey: string;
  accountId: string;
  primaryEmail: string;
  secondaryEmail: string;
}

/** Returns env vars if all required ones are present, otherwise `undefined`. */
export function loadEnv(): TestEnv | undefined {
  const baseUrl = process.env.ASSINAFY_BASE_URL ?? "https://sandbox.assinafy.com.br/v1";
  const apiKey = process.env.ASSINAFY_API_KEY;
  const accountId = process.env.ASSINAFY_ACCOUNT_ID;
  if (!apiKey || !accountId) return undefined;
  return {
    baseUrl,
    apiKey,
    accountId,
    primaryEmail: process.env.ASSINAFY_TEST_EMAIL_PRIMARY ?? "bill@febacapital.com",
    secondaryEmail: process.env.ASSINAFY_TEST_EMAIL_SECONDARY ?? "billm@billm.org",
  };
}

/** Make a tiny in-memory PDF so live tests don't depend on the filesystem. */
export function makeMinimalPdf(text = "chat-sdk test"): Uint8Array {
  // Smallest hand-crafted PDF that Assinafy will accept (single page, one TJ text).
  const lines = [
    "%PDF-1.4",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
    `4 0 obj << /Length ${(`BT /F1 24 Tf 50 750 Td (${text}) Tj ET`).length} >>`,
    "stream",
    `BT /F1 24 Tf 50 750 Td (${text}) Tj ET`,
    "endstream",
    "endobj",
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    "xref",
    "0 6",
    "0000000000 65535 f ",
    "0000000010 00000 n ",
    "0000000060 00000 n ",
    "0000000110 00000 n ",
    "0000000210 00000 n ",
    "0000000330 00000 n ",
    "trailer << /Size 6 /Root 1 0 R >>",
    "startxref",
    "420",
    "%%EOF",
  ];
  return new TextEncoder().encode(lines.join("\n"));
}
