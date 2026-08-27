import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const OPENAPI_URL = "https://api.assinafy.com.br/v1/docs/openapi.json";
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
const DOCUMENT_STATS_ROW_KEYS = [
  "documents_certified",
  "documents_sent",
  "documents_uploaded",
  "period",
  "signature_requests",
  "signature_requests_completed",
  "signature_requests_notification_bypass",
  "signature_requests_notification_email",
  "signature_requests_notification_whatsapp",
  "signature_requests_verification_bypass",
  "signature_requests_verification_digital_certificate",
  "signature_requests_verification_email",
  "signature_requests_verification_whatsapp",
  "signature_requests_viewed",
];

describe("Assinafy production OpenAPI contract", () => {
  it("maps every published operation in API_COVERAGE.md", async () => {
    const response = await fetch(OPENAPI_URL);
    expect(response.ok).toBe(true);
    const coverage = await readFile(
      new URL("../../docs/API_COVERAGE.md", import.meta.url),
      "utf8",
    );
    const spec = await response.json() as {
      components?: {
        schemas?: {
          DocumentStatsRow?: { properties?: Record<string, unknown> };
        };
      };
      paths?: Record<string, Record<string, unknown>>;
    };
    const published = Object.entries(spec.paths ?? {}).flatMap(([path, item]) =>
      Object.keys(item)
        .filter((method) => HTTP_METHODS.has(method))
        .map((method) => `${method.toUpperCase()} ${path}`),
    );
    const documented = [...coverage.matchAll(/^\| (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \| `([^`]+)` \|/gm)]
      .map((match) => `${match[1]} ${match[2]}`);

    expect(published).toHaveLength(89);
    expect(new Set(documented).size).toBe(documented.length);
    expect(documented.sort()).toEqual(published.sort());

    const statsSchemaReference = "#/components/schemas/DocumentStatsRow";
    for (const path of ["/v1/accounts/{accountId}/stats", "/v1/users/self/stats"]) {
      expect(JSON.stringify(spec.paths?.[path]?.get)).toContain(statsSchemaReference);
    }
    expect(Object.keys(spec.components?.schemas?.DocumentStatsRow?.properties ?? {}).sort())
      .toEqual(DOCUMENT_STATS_ROW_KEYS);
  });
});
