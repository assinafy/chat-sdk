import { describe, expect, it, vi } from "vitest";
import { EmbeddedResource } from "../../src/client/embedded.js";
import { ApiError, ConfigurationError } from "../../src/client/errors.js";
import { HttpClient, type AuthStrategy } from "../../src/client/http.js";

function setup(data: unknown = [], status = 200, auth: AuthStrategy = { kind: "apiKey", apiKey: "workspace-key" }) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({
    status, message: status === 200 ? "Success" : "Unavailable", data,
    ...(status === 410 ? { code: "embed_session_invalid" } : {}),
  }), { status, headers: { "content-type": "application/json" } }));
  const http = new HttpClient({ baseUrl: "https://example.test/v1", auth, fetch, maxRetries: 2 });
  return { embedded: new EmbeddedResource(http), fetch };
}

describe("EmbeddedResource", () => {
  const origin = { id: "origin", origin: "https://app.example.test", created_at: "2026-11-11T12:00:00Z" };

  it("lists origins with workspace authentication and preserves the complete response", async () => {
    const { embedded, fetch } = setup([origin]);
    await expect(embedded.listOrigins("account/a")).resolves.toEqual([origin]);
    expect(String(fetch.mock.calls[0]![0])).toBe("https://example.test/v1/accounts/account%2Fa/embed-origins");
    expect(fetch.mock.calls[0]![1]?.method).toBe("GET");
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).get("X-Api-Key")).toBe("workspace-key");
  });

  it("creates, updates and deletes origins with encoded IDs and only declared fields", async () => {
    const { embedded, fetch } = setup(origin);
    const input = { origin: "https://APP.example.test:443/", secret: "omit" };
    await expect(embedded.createOrigin("account/a", input)).resolves.toEqual(origin);
    await expect(embedded.updateOrigin("account/a", "origin/b", input)).resolves.toEqual(origin);
    await expect(embedded.deleteOrigin("account/a", "origin/b")).resolves.toBeUndefined();
    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      "/v1/accounts/account%2Fa/embed-origins",
      "/v1/accounts/account%2Fa/embed-origins/origin%2Fb",
      "/v1/accounts/account%2Fa/embed-origins/origin%2Fb",
    ]);
    expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "PUT", "DELETE"]);
    for (const [, init] of fetch.mock.calls.slice(0, 2)) {
      expect(JSON.parse(String(init?.body))).toEqual({ origin: input.origin });
    }
    expect(fetch.mock.calls[2]![1]?.body).toBeUndefined();
  });

  it("mints a session without a request body and preserves its bearer URL", async () => {
    const session = { url: "https://app.example.test/embed/test-token#fragment", expires_at: "2026-11-11T12:05:00Z" };
    const { embedded, fetch } = setup(session);
    await expect(embedded.createSession("document/a", "assignment/b", "signer/c")).resolves.toEqual(session);
    expect(String(fetch.mock.calls[0]![0])).toBe("https://example.test/v1/documents/document%2Fa/assignments/assignment%2Fb/signers/signer%2Fc/embed-sessions");
    expect(fetch.mock.calls[0]![1]?.method).toBe("POST");
    expect(fetch.mock.calls[0]![1]?.body).toBeUndefined();
  });

  it.each<AuthStrategy>([
    { kind: "apiKey", apiKey: "workspace-key" },
    { kind: "bearer", token: "workspace-token" },
  ])("exchanges with only the session token and preserves signing data ($kind)", async (auth) => {
    const response = {
      signer_access_code: "example-access-code", signer_id: "signer", document_id: "document",
      verification_method: "Email", embed_origins: [origin.origin],
    };
    const { embedded, fetch } = setup(response, 200, auth);
    await expect(embedded.exchangeSession("token/with?reserved", {
      parent_origin: origin.origin, ...{ ignored: true },
    })).resolves.toEqual(response);
    await embedded.exchangeSession("another-token");
    expect(String(fetch.mock.calls[0]![0])).toBe("https://example.test/v1/embed/sessions/token%2Fwith%3Freserved/exchange");
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({ parent_origin: origin.origin });
    expect(fetch.mock.calls[1]![1]?.body).toBeUndefined();
    for (const [, init] of fetch.mock.calls) {
      const headers = new Headers(init?.headers);
      expect(headers.has("X-Api-Key")).toBe(false);
      expect(headers.has("Authorization")).toBe(false);
    }
  });

  it.each(["", " ", undefined])("rejects a missing token before fetch (%s)", async (token) => {
    const { embedded, fetch } = setup();
    const result = embedded.exchangeSession(token as string);
    await expect(result).rejects.toBeInstanceOf(ConfigurationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([400, 403, 409, 410, 429, 500])("preserves HTTP %i and never retries embedded mutations", async (status) => {
    const { embedded, fetch } = setup(null, status);
    for (const call of [
      () => embedded.createOrigin("account", { origin: origin.origin }),
      () => embedded.updateOrigin("account", "origin", { origin: origin.origin }),
      () => embedded.deleteOrigin("account", "origin"),
      () => embedded.createSession("document", "assignment", "signer"),
      () => embedded.exchangeSession("example-token"),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(ApiError);
    }
    expect(fetch).toHaveBeenCalledTimes(5);
  });
});
