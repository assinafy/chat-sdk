import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { AssinafyClient } from "../../src/client/index.js";
import { ApiError, OAuthError } from "../../src/client/errors.js";

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

    expect(published).toHaveLength(93);
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

/**
 * OAuth is served by production only — the sandbox host answers `404` for
 * `/v1/oauth/*` and `403` for the protected-resource document. These checks
 * therefore run against production, which is safe: every one of them is
 * unauthenticated and read-only, and the token probe uses a client id that
 * cannot exist.
 */
describe("Assinafy production OAuth contract", () => {
  const client = new AssinafyClient();

  it("publishes discovery documents that agree with each other", async () => {
    const resource = await client.oauth.getProtectedResourceMetadata();
    expect(resource.resource).toBe("https://api.assinafy.com.br");
    expect(resource.authorization_servers[0]).toBe("https://auth.assinafy.com.br");
    expect(resource.bearer_methods_supported).toEqual(["header"]);
    // `offline_access` asks the authorization server for a refresh token; it is
    // not a permission this API enforces, so it must not appear here.
    expect(resource.scopes_supported).not.toContain("offline_access");

    const server = await client.oauth.getAuthorizationServerMetadata();
    expect(server.issuer).toBe(resource.authorization_servers[0]);
    expect(server.token_endpoint).toBe("https://api.assinafy.com.br/v1/oauth/token");
    expect(server.revocation_endpoint).toBe("https://api.assinafy.com.br/v1/oauth/revoke");
    expect(server.userinfo_endpoint).toBe("https://api.assinafy.com.br/v1/oauth/userinfo");
    expect(server.code_challenge_methods_supported).toEqual(["S256"]);
    expect(server.scopes_supported).toContain("offline_access");
  });

  it("builds an authorization URL against the discovered endpoint", async () => {
    const request = await client.oauth.createAuthorizationUrl({
      clientId: "contract-probe",
      redirectUri: "https://example.test/oauth/callback",
      scopes: ["documents:read", "offline_access"],
    });
    const url = new URL(request.url);
    expect(url.origin).toBe("https://auth.assinafy.com.br");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("resource")).toBe("https://api.assinafy.com.br");
    expect(request.codeVerifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
  });

  it("reports an unknown application as invalid_client", async () => {
    const failure = await client.oauth
      .refreshToken({ refreshToken: "not-a-token", clientId: "contract-probe" })
      .then(() => undefined, (error: unknown) => error);
    expect(failure).toBeInstanceOf(OAuthError);
    expect(failure).toMatchObject({ status: 401, error: "invalid_client" });
  });

  it("challenges an unauthenticated userinfo read without an error code", async () => {
    const failure = await client.oauth
      .getUserInfo("not-a-token")
      .then(() => undefined, (error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).not.toBeInstanceOf(OAuthError);
    expect((failure as ApiError).status).toBe(401);
    expect((failure as ApiError).wwwAuthenticate).toContain("resource_metadata=");
  });
});
