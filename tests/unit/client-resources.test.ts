import { describe, expect, it, vi } from "vitest";
import { AssinafyClient, ConfigurationError } from "../../src/client/index.js";

interface RecordedRequest {
  url: string;
  init: RequestInit;
  body: unknown;
  method: string;
}

function mkResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ status: 200, message: "", data: body }), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

function makeClient(responses: unknown[] = []): { client: AssinafyClient; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchImpl = vi.fn().mockImplementation(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    requests.push({ url, init, body, method });
    const next = responses.length > 0 ? responses.shift() : {};
    return Array.isArray(next)
      ? mkResponse(next, {
          "x-pagination-current-page": "1",
          "x-pagination-page-count": "1",
          "x-pagination-per-page": String(next.length),
          "x-pagination-total-count": String(next.length),
        })
      : mkResponse(next);
  });
  const client = new AssinafyClient({
    apiKey: "test-key",
    accountId: "acct",
    baseUrl: "https://sandbox.test/v1",
    fetch: fetchImpl as unknown as typeof fetch,
    maxRetries: 0,
  });
  return { client, requests };
}

describe("AssinafyClient resource paths", () => {
  it("forwards every transport option to the HttpClient and keeps credentials out of it", async () => {
    const rateLimits: unknown[] = [];
    const fetchImpl = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ status: 200, message: "", data: [] }), {
        status: 200,
        headers: { "content-type": "application/json", "x-rate-limit-limit": "42" },
      }),
    );
    const client = new AssinafyClient({
      apiKey: "test-key",
      accountId: "acct",
      baseUrl: "https://sandbox.test/v1",
      fetch: fetchImpl as unknown as typeof fetch,
      userAgent: "custom-agent/1.0",
      maxRetries: 0,
      retryBaseDelayMs: 1,
      onRateLimit: (limit) => rateLimits.push(limit),
    });

    await client.documents.statuses();

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(new Headers(init.headers).get("user-agent")).toBe("custom-agent/1.0");
    expect(rateLimits).toEqual([{ limit: 42, remaining: 0, resetSeconds: 0 }]);
    expect(client.accountId).toBe("acct");
    // Credentials are consumed into the auth strategy, never left as loose
    // transport options.
    expect(client.http.auth).toEqual({ kind: "apiKey", apiKey: "test-key" });
  });

  it("allows unauthenticated clients for login and public flows", async () => {
    const requests: RecordedRequest[] = [];
    const fetchImpl = vi.fn().mockImplementation(async (url: string, init: RequestInit = {}) => {
      requests.push({
        url,
        init,
        body: typeof init.body === "string" ? JSON.parse(init.body) : init.body,
        method: init.method ?? "GET",
      });
      return mkResponse({ access_token: "token" });
    });

    const client = new AssinafyClient({
      baseUrl: "https://sandbox.test/v1",
      fetch: fetchImpl as unknown as typeof fetch,
    });
    await client.auth.login({ email: "user@example.com", password: "pw" });

    expect(requests[0]!.url).toBe("https://sandbox.test/v1/login");
    expect(new Headers(requests[0]!.init.headers).has("X-Api-Key")).toBe(false);
    expect(new Headers(requests[0]!.init.headers).has("authorization")).toBe(false);
  });

  it("uses the documented single API-key endpoints", async () => {
    const { client, requests } = makeClient([{ api_key: "masked" }, {}]);

    await client.auth.getApiKey();
    await client.auth.deleteApiKey();

    expect(requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "GET /v1/users/api-keys",
      "DELETE /v1/users/api-keys",
    ]);
  });

  it("expands assignment signerIds/signer_ids into the documented `signers` array", async () => {
    const { client, requests } = makeClient([{}, {}, {}, {}, {}, {}]);

    // Both convenience aliases must expand to `signers: [{ id }]` (the only shape
    // the API honors) and merge with any explicit `signers`.
    await client.assignments.create("doc 1", { method: "virtual", signerIds: ["s1"] });
    await client.assignments.create("doc 1", { method: "virtual", signer_ids: ["s2", "s3"] });
    await client.assignments.create("doc 1", {
      method: "virtual",
      signers: [{ id: "s1", step: 1 }],
      signer_ids: ["s1", "s2"],
    });
    await client.assignments.create("doc 1", {
      method: "virtual",
      signers: [{ id: "s1" }],
      expiration: "2030-08-03T21:00:00Z",
    });
    await client.assignments.create("doc 1", {
      method: "collect",
      signers: [{ id: "s1" }],
      entries: [{ page_id: "p1", fields: [] }],
    });
    await client.assignments.create("doc 1", {
      method: "virtual",
      signer_ids: ["s2", "s3"],
      signerIds: ["s1", "s2", "s1"],
    });

    expect(requests[0]!.body).toEqual({ method: "virtual", signers: [{ id: "s1" }] });
    expect(requests[1]!.body).toEqual({ method: "virtual", signers: [{ id: "s2" }, { id: "s3" }] });
    // Explicit signers win; ids already present are not duplicated.
    expect(requests[2]!.body).toEqual({
      method: "virtual",
      signers: [{ id: "s1", step: 1 }, { id: "s2" }],
    });
    expect(requests[3]!.body).toEqual({
      method: "virtual",
      signers: [{ id: "s1" }],
      expires_at: "2030-08-03T21:00:00Z",
    });
    expect(requests[4]!.body).toEqual({
      method: "collect",
      signers: [{ id: "s1" }],
      entries: [{ page_id: "p1", fields: [] }],
    });
    expect(requests[5]!.body).toEqual({
      method: "virtual",
      signers: [{ id: "s2" }, { id: "s3" }, { id: "s1" }],
    });
  });

  it("rejects assignments that the API cannot execute", () => {
    const { client, requests } = makeClient();

    expect(() =>
      client.assignments.create("doc", { method: "virtual" } as never),
    ).toThrow("at least one signer");
    expect(() =>
      client.assignments.create("doc", {
        method: "collect",
        signers: [{ id: "s1" }],
      } as never),
    ).toThrow("at least one field entry");
    expect(requests).toHaveLength(0);
  });

  it("covers assignment resend, resend-estimate, reset-expiration, and notifications", async () => {
    const { client, requests } = makeClient([{}, {}, {}, []]);

    await client.assignments.resendToSigner("doc 1", "asn 1", "s1");
    await client.assignments.estimateResendCost("doc 1", "asn 1", "s1");
    await client.assignments.resetExpiration("doc 1", "asn 1", "2030-08-03T21:00:00Z");
    await client.assignments.whatsappNotifications("doc 1", "asn 1");

    expect(requests[0]!.method).toBe("PUT");
    expect(new URL(requests[0]!.url).pathname).toBe("/v1/documents/doc%201/assignments/asn%201/signers/s1/resend");
    expect(requests[1]!.method).toBe("POST");
    expect(new URL(requests[1]!.url).pathname).toBe(
      "/v1/documents/doc%201/assignments/asn%201/signers/s1/estimate-resend-cost",
    );
    expect(requests[2]!.method).toBe("PUT");
    expect(new URL(requests[2]!.url).pathname).toBe("/v1/documents/doc%201/assignments/asn%201/reset-expiration");
    expect(requests[2]!.body).toEqual({ expires_at: "2030-08-03T21:00:00Z" });
    expect(requests[3]!.method).toBe("GET");
    expect(new URL(requests[3]!.url).pathname).toBe(
      "/v1/documents/doc%201/assignments/asn%201/whatsapp-notifications",
    );
  });

  it("serializes documented CSV tag filters for documents and templates", async () => {
    const { client, requests } = makeClient([[], []]);

    await client.documents.list("acct", {
      tags: ["tag1", "tag2"],
      status: ["metadata_ready", "pending_signature"],
      perPage: 10,
    });
    await client.templates.list("acct", { tags: ["tag1", "tag2"], sort: "-updated_at" });

    expect(new URL(requests[0]!.url).searchParams.get("tags")).toBe("tag1,tag2");
    expect(new URL(requests[0]!.url).searchParams.get("status")).toBe(
      "metadata_ready,pending_signature",
    );
    expect(new URL(requests[0]!.url).searchParams.get("per-page")).toBe("10");
    expect(new URL(requests[1]!.url).searchParams.get("tags")).toBe("tag1,tag2");
    expect(new URL(requests[1]!.url).searchParams.get("sort")).toBe("-updated_at");
  });

  it("covers template get, instantiate, and estimate-cost paths", async () => {
    const { client, requests } = makeClient([{}, {}, {}]);

    await client.templates.get("acct", "tpl 1");
    await client.templates.instantiate("acct", "tpl 1", {
      signers: [{ role_id: "role1", id: "signer1" }],
    });
    await client.templates.estimateCost("acct", "tpl 1", [{ role_id: "role1" }]);

    expect(requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "GET /v1/accounts/acct/templates/tpl%201",
      "POST /v1/accounts/acct/templates/tpl%201/documents",
      "POST /v1/accounts/acct/templates/tpl%201/documents/estimate-cost",
    ]);
    expect(requests[1]!.body).toEqual({ signers: [{ role_id: "role1", id: "signer1" }] });
    expect(requests[2]!.body).toEqual({ signers: [{ role_id: "role1" }] });
  });

  it("covers field CRUD and validation endpoint shapes", async () => {
    const { client, requests } = makeClient([{}, [], {}, {}, {}, {}, [], []]);

    await client.fields.create("acct", { type: "text", name: "Reference" });
    await client.fields.list("acct", { include_standard: true, include_inactive: true });
    await client.fields.get("acct", "field 1");
    await client.fields.update("acct", "field 1", { name: "Reference ID" });
    await client.fields.validate("acct", "field 1", "abc", { accessCode: "code" });
    await client.fields.validateMultiple("acct", [{ field_id: "field 1", value: "abc" }], { accessCode: "code" });
    await client.fields.listTypes();
    await client.fields.remove("acct", "field 1");

    expect(requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "POST /v1/accounts/acct/fields",
      "GET /v1/accounts/acct/fields",
      "GET /v1/accounts/acct/fields/field%201",
      "PUT /v1/accounts/acct/fields/field%201",
      "POST /v1/accounts/acct/fields/field%201/validate",
      "POST /v1/accounts/acct/fields/validate-multiple",
      "GET /v1/field-types",
      "DELETE /v1/accounts/acct/fields/field%201",
    ]);
    expect(new URL(requests[1]!.url).searchParams.get("include_standard")).toBe("true");
    expect(new URL(requests[1]!.url).searchParams.has("per-page")).toBe(false);
    expect(new URL(requests[4]!.url).searchParams.get("signer-access-code")).toBe("code");
    expect(requests[5]!.body).toEqual([{ field_id: "field 1", value: "abc" }]);
  });

  it("covers webhook subscription, event type, dispatch, and retry paths", async () => {
    const { client, requests } = makeClient([null, {}, {}, [], [], {}]);

    await client.webhooks.getSubscription("acct");
    await client.webhooks.updateSubscription("acct", {
      events: ["document_ready"],
      is_active: true,
      url: "https://example.com/webhook",
      email: "ops@example.com",
    });
    await client.webhooks.inactivate("acct");
    await client.webhooks.listEventTypes();
    await client.webhooks.listDispatches("acct", { delivered: false, page: 2, perPage: 20 });
    await client.webhooks.retryDispatch("acct", "dispatch 1");

    expect(requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "GET /v1/accounts/acct/webhooks/subscriptions",
      "PUT /v1/accounts/acct/webhooks/subscriptions",
      "PUT /v1/accounts/acct/webhooks/inactivate",
      "GET /v1/webhooks/event-types",
      "GET /v1/accounts/acct/webhooks",
      "POST /v1/accounts/acct/webhooks/dispatch%201/retry",
    ]);
    expect(requests[1]!.body).toMatchObject({ events: ["document_ready"], is_active: true });
    expect(new URL(requests[4]!.url).searchParams.get("delivered")).toBe("false");
  });

  it("covers signer-facing document and multi-sign endpoints", async () => {
    const { client, requests } = makeClient([{}, [], {}, {}, new Response("pdf")]);

    await client.signature.signContext("code", { hasAcceptedTerms: true });
    await client.signature.listDocuments("signer 1", "code", {
      tags: ["tag1", "tag2"],
      status: "pending_signature",
    });
    await client.signature.signMultiple("code", ["doc1", "doc2"]);
    await client.signature.declineMultiple("code", ["doc1"], "No");
    await client.signature.downloadDocument("signer 1", "doc 1", "original", "code");

    expect(requests[0]!.method).toBe("GET");
    expect(new URL(requests[0]!.url).pathname).toBe("/v1/sign");
    expect(new URL(requests[0]!.url).searchParams.get("has_accepted_terms")).toBe("true");
    expect(new URL(requests[1]!.url).pathname).toBe("/v1/signers/signer%201/documents");
    expect(new URL(requests[1]!.url).searchParams.get("tags")).toBe("tag1,tag2");
    expect(requests[2]!.body).toEqual({ document_ids: ["doc1", "doc2"] });
    expect(requests[3]!.body).toEqual({ document_ids: ["doc1"], decline_reason: "No" });
    expect(new URL(requests[4]!.url).pathname).toBe("/v1/signers/signer%201/documents/doc%201/download/original");
    expect(new URL(requests[4]!.url).searchParams.has("signer-access-code")).toBe(false);
  });

  it("rejects invalid pagination before transport", () => {
    const { client, requests } = makeClient();

    expect(() => client.signers.list("acct", { page: 0 })).toThrow("positive integer");
    expect(() => client.documents.list("acct", { perPage: 101 })).toThrow("between 1 and 100");
    expect(requests).toHaveLength(0);
  });

  it("covers signers resource CRUD paths and self confirm-data", async () => {
    const { client, requests } = makeClient([[], {}, {}, {}, {}, {}]);

    await client.signers.list("acct", { search: "alice", perPage: 5 });
    await client.signers.create("acct", { full_name: "Alice", email: "signer@example.test" });
    await client.signers.get("acct", "s 1");
    await client.signers.update("acct", "s 1", { full_name: "Alice B" });
    await client.signers.remove("acct", "s 1");
    await client.signers.confirmDataForDocument("doc 1", "code", { government_id: "123" });

    expect(requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "GET /v1/accounts/acct/signers",
      "POST /v1/accounts/acct/signers",
      "GET /v1/accounts/acct/signers/s%201",
      "PUT /v1/accounts/acct/signers/s%201",
      "DELETE /v1/accounts/acct/signers/s%201",
      "PUT /v1/documents/doc%201/signers/confirm-data",
    ]);
    expect(new URL(requests[0]!.url).searchParams.get("per-page")).toBe("5");
    expect(new URL(requests[5]!.url).searchParams.get("signer-access-code")).toBe("code");
    expect(requests[5]!.body).toEqual({ government_id: "123" });
  });

  it("preserves nullable assignment-signer notification history", async () => {
    const { client } = makeClient([{
      id: "s1",
      full_name: "Alice",
      email: null,
      has_accepted_terms: false,
      completed: null,
      notification_history: null,
    }]);

    await expect(client.signers.get("acct", "s1")).resolves.toMatchObject({
      completed: null,
      notification_history: null,
    });
  });

  it("puts the signer-access-code in the QUERY for acceptTerms and verify (not the body)", async () => {
    const { client, requests } = makeClient([{}, {}]);

    await client.signature.acceptTerms("the-code");
    await client.signature.verify("the-code", "123456");

    expect(requests[0]!.method).toBe("PUT");
    expect(new URL(requests[0]!.url).pathname).toBe("/v1/signers/accept-terms");
    expect(new URL(requests[0]!.url).searchParams.get("signer-access-code")).toBe("the-code");
    expect(requests[0]!.body).toBeUndefined();

    expect(requests[1]!.method).toBe("POST");
    expect(new URL(requests[1]!.url).pathname).toBe("/v1/verify");
    expect(new URL(requests[1]!.url).searchParams.get("signer-access-code")).toBe("the-code");
    // The body carries ONLY the verification code — not the access code.
    expect(requests[1]!.body).toEqual({ "verification-code": "123456" });
  });

  it("sends the documented {email} body for sendPublicToken", async () => {
    const { client, requests } = makeClient([{}]);

    await client.documents.sendPublicToken("doc 1", { email: "a@example.com" });

    expect(requests[0]!.method).toBe("PUT");
    expect(new URL(requests[0]!.url).pathname).toBe("/v1/public/documents/doc%201/send-token");
    expect(requests[0]!.body).toEqual({ email: "a@example.com" });
  });

  it("allows the documented public-token request without a body", async () => {
    const { client, requests } = makeClient([{}]);

    await client.documents.sendPublicToken("doc 1");

    expect(requests[0]!.method).toBe("PUT");
    expect(requests[0]!.body).toBeUndefined();
    expect(new Headers(requests[0]!.init.headers).has("content-type")).toBe(false);
  });

  it("never retries a rejected notification request and supports an explicit legacy body", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn().mockImplementationOnce(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return new Response(
        JSON.stringify({ status: 422, message: "invalid request", data: null }),
        { status: 422, headers: { "content-type": "application/json" } },
      );
    }).mockImplementationOnce(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return mkResponse({ recipient: "a@example.com", channel: "email" });
    });
    const client = new AssinafyClient({
      baseUrl: "https://sandbox.test/v1",
      fetch: fetchImpl as unknown as typeof fetch,
      maxRetries: 0,
    });

    await expect(
      client.documents.sendPublicToken("doc", { email: "a@example.com" }),
    ).rejects.toMatchObject({ status: 422 });
    expect(fetchImpl).toHaveBeenCalledOnce();

    await client.documents.sendPublicToken("doc", {
      recipient: "a@example.com",
      channel: "email",
    });
    expect(bodies).toEqual([
      { email: "a@example.com" },
      { recipient: "a@example.com", channel: "email" },
    ]);
  });

  it("covers document search and rename", async () => {
    const { client, requests } = makeClient([[], {}]);

    await client.documents.search("acct", { search: "contract", status: "metadata_ready", perPage: 5 });
    await client.documents.rename("doc 1", "New Name.pdf");

    expect(requests[0]!.method).toBe("GET");
    expect(new URL(requests[0]!.url).pathname).toBe("/v1/accounts/acct/documents/search");
    expect(new URL(requests[0]!.url).searchParams.get("search")).toBe("contract");
    expect(new URL(requests[0]!.url).searchParams.get("status")).toBe("metadata_ready");
    expect(new URL(requests[0]!.url).searchParams.get("per-page")).toBe("5");
    expect(requests[1]!.method).toBe("PATCH");
    expect(new URL(requests[1]!.url).pathname).toBe("/v1/documents/doc%201");
    expect(requests[1]!.body).toEqual({ name: "New Name.pdf" });
  });

  it("covers the accounts resource (CRUD, theme, logo, force delete)", async () => {
    const stats = [{
      period: "2026-08-01",
      documents_uploaded: 1,
      documents_sent: 1,
      signature_requests: 1,
      signature_requests_notification_bypass: 0,
      signature_requests_notification_email: 1,
      signature_requests_notification_whatsapp: 0,
      signature_requests_verification_bypass: 0,
      signature_requests_verification_email: 1,
      signature_requests_verification_whatsapp: 0,
      signature_requests_verification_digital_certificate: 0,
      signature_requests_viewed: 1,
      signature_requests_completed: 1,
      documents_certified: 1,
    }];
    const { client, requests } = makeClient([[], {}, {}, {}, {}, {}, stats, {}]);

    await client.accounts.list();
    await client.accounts.create({ name: "Acme", notification_sender_type: "Account" });
    await client.accounts.get("acct");
    await client.accounts.update("acct", { name: "Acme Inc." });
    await client.accounts.remove("acct", { force: true });
    await client.accounts.getTheme("acct");
    await expect(
      client.accounts.getStats("acct", { granularity: "daily", month: "2026-08" }),
    ).resolves.toEqual(stats);
    await client.accounts.deleteLogo("acct");

    expect(requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "GET /v1/accounts",
      "POST /v1/accounts",
      "GET /v1/accounts/acct",
      "PUT /v1/accounts/acct",
      "DELETE /v1/accounts/acct",
      "GET /v1/accounts/acct/theme",
      "GET /v1/accounts/acct/stats",
      "DELETE /v1/accounts/acct/logo",
    ]);
    expect(requests[1]!.body).toEqual({ name: "Acme", notification_sender_type: "Account" });
    expect(requests[4]!.body).toEqual({ force: true });
    expect(new URL(requests[6]!.url).searchParams.get("granularity")).toBe("daily");
    expect(new URL(requests[6]!.url).searchParams.get("month")).toBe("2026-08");
  });

  it("covers the authenticated-user profile, statistics, and preferences", async () => {
    const { client, requests } = makeClient([
      { user: { id: "u1", name: "User", email: "user@example.com" }, accounts: [] },
      [],
      { DocumentCompleted: true },
      { DocumentCompleted: false },
    ]);

    await expect(client.users.getCurrent()).resolves.toMatchObject({ id: "u1" });
    await client.users.getStats();
    await client.users.getNotificationPreferences();
    await client.users.updateNotificationPreferences({ DocumentCompleted: false });

    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      "GET /v1/users/self",
      "GET /v1/users/self/stats",
      "GET /v1/users/self/notification-preferences",
      "PUT /v1/users/self/notification-preferences",
    ]);
    expect(requests[3]!.body).toEqual({ DocumentCompleted: false });
  });

  it("covers assignments.list and auth.linkSocialLogin", async () => {
    const { client, requests } = makeClient([[], {}]);

    await client.assignments.list({ perPage: 10 });
    await client.auth.linkSocialLogin({ provider: "google", token: "tok" });

    expect(requests[0]!.method).toBe("GET");
    expect(new URL(requests[0]!.url).pathname).toBe("/v1/assignments");
    expect(new URL(requests[0]!.url).searchParams.get("per-page")).toBe("10");
    expect(requests[1]!.method).toBe("POST");
    expect(new URL(requests[1]!.url).pathname).toBe("/v1/auth/link-social-login");
    expect(requests[1]!.body).toEqual({ provider: "google", token: "tok" });
  });

  it("searches signer documents with the access code in the query", async () => {
    const { client, requests } = makeClient([[], {}]);

    await client.signature.searchDocuments("signer 1", "code", "contract");
    await client.signature.downloadDocument("signer 1", "doc 1", "original");

    expect(requests[0]!.method).toBe("GET");
    expect(new URL(requests[0]!.url).pathname).toBe("/v1/signers/signer%201/documents/search");
    expect(new URL(requests[0]!.url).searchParams.get("signer-access-code")).toBe("code");
    expect(new URL(requests[0]!.url).searchParams.get("search")).toBe("contract");
    expect(new URL(requests[1]!.url).searchParams.has("signer-access-code")).toBe(false);
  });

  it("covers every authentication route and alias", async () => {
    const { client, requests } = makeClient([
      {}, {}, {}, {}, { api_key: "masked" }, { api_key: "masked" }, {}, {}, {}, {}, {},
    ]);

    await client.auth.login({ email: "user@example.com", password: "old" });
    await client.auth.socialLogin({ provider: "google", token: "identity", has_accepted_terms: true });
    await client.auth.linkSocialLogin({ provider: "google", token: "identity" });
    await client.auth.createApiKey("old");
    await client.auth.getApiKey();
    await expect(client.auth.listApiKeys()).resolves.toHaveLength(1);
    await client.auth.deleteApiKey();
    await client.auth.revokeApiKeys();
    await client.auth.changePassword({ email: "user@example.com", password: "old", new_password: "new" });
    await client.auth.requestPasswordReset({ email: "user@example.com" });
    await client.auth.resetPassword({ email: "user@example.com", token: "token", new_password: "new" });

    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      "POST /v1/login",
      "POST /v1/authentication/social-login",
      "POST /v1/auth/link-social-login",
      "POST /v1/users/api-keys",
      "GET /v1/users/api-keys",
      "GET /v1/users/api-keys",
      "DELETE /v1/users/api-keys",
      "DELETE /v1/users/api-keys",
      "PUT /v1/authentication/change-password",
      "PUT /v1/authentication/request-password-reset",
      "PUT /v1/authentication/reset-password",
    ]);
  });

  it("covers document upload, lookup, binaries, public routes, and removal", async () => {
    const { client, requests } = makeClient([{}, {}, {}, {}, {}, {}, [], {}, {}, {}, {}]);

    await client.documents.upload("acct", {
      filename: "contract.pdf",
      body: new Uint8Array([1, 2, 3]),
      tags: ["legacy-tag"],
    });
    await client.documents.get("doc 1");
    await client.documents.download("doc 1", "original");
    await client.documents.thumbnail("doc 1");
    await client.documents.downloadPage("doc 1", "page 1");
    await client.documents.activities("doc 1");
    await client.documents.verify("signature hash");
    await client.documents.publicGet("doc 1");
    await client.documents.sendPublicToken("doc 1", { email: "signer@example.com" });
    await client.documents.statuses();
    await client.documents.remove("doc 1");

    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      "POST /v1/accounts/acct/documents",
      "GET /v1/documents/doc%201",
      "GET /v1/documents/doc%201/download/original",
      "GET /v1/documents/doc%201/thumbnail",
      "GET /v1/documents/doc%201/pages/page%201/download",
      "GET /v1/documents/doc%201/activities",
      "GET /v1/documents/signature%20hash/verify",
      "GET /v1/public/documents/doc%201",
      "PUT /v1/public/documents/doc%201/send-token",
      "GET /v1/documents/statuses",
      "DELETE /v1/documents/doc%201",
    ]);
    expect(requests[0]!.body).toBeInstanceOf(FormData);
  });

  it("honors upload MIME overrides and rejects files over 25 MB before transport", async () => {
    const { client, requests } = makeClient([{}]);

    await client.documents.upload("acct", {
      filename: "contract.pdf",
      body: new Blob(["pdf"], { type: "text/plain" }),
      contentType: "application/pdf",
    });
    const file = (requests[0]!.body as FormData).get("file") as Blob;
    expect(file.type).toBe("application/pdf");

    await expect(client.documents.upload("acct", {
      filename: "too-large.pdf",
      body: new ArrayBuffer(25 * 1024 * 1024 + 1),
    })).rejects.toBeInstanceOf(ConfigurationError);
    expect(requests).toHaveLength(1);
  });

  it("covers tag CRUD and document attachment routes with tag IDs", async () => {
    const { client, requests } = makeClient([[], {}, {}, [], [], [], {}, {}]);

    await client.tags.list("acct", "legal");
    await client.tags.create("acct", { name: "Legal", color: "#112233" });
    await client.tags.update("acct", "tag 1", { color: "#445566" });
    await client.tags.listForDocument("acct", "doc 1");
    await client.tags.setForDocument("acct", "doc 1", ["tag 1"]);
    await client.tags.addToDocument("acct", "doc 1", ["tag 2"]);
    await client.tags.removeFromDocument("acct", "doc 1", "tag 1");
    await client.tags.remove("acct", "tag 2", { force: true });

    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      "GET /v1/accounts/acct/tags",
      "POST /v1/accounts/acct/tags",
      "PUT /v1/accounts/acct/tags/tag%201",
      "GET /v1/accounts/acct/documents/doc%201/tags",
      "PUT /v1/accounts/acct/documents/doc%201/tags",
      "POST /v1/accounts/acct/documents/doc%201/tags",
      "DELETE /v1/accounts/acct/documents/doc%201/tags/tag%201",
      "DELETE /v1/accounts/acct/tags/tag%202",
    ]);
    expect(requests[4]!.body).toEqual({ tags: ["tag 1"] });
    expect(new URL(requests[7]!.url).searchParams.get("force")).toBe("true");
  });

  it("covers signer image, signer assignment, and account logo operations", async () => {
    const { client, requests } = makeClient([{}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}]);

    await client.signature.self("secret");
    await client.signature.upload("secret", "signature", new Uint8Array([1]), "image/png");
    await client.signature.upload("secret", undefined, new Uint8Array([1]));
    await client.signature.download("secret", "signature");
    await client.signature.currentDocument("signer 1", "secret");
    await client.signature.sign("doc 1", "assignment 1", "secret", [
      { itemId: "item", fieldId: "field", pageId: "page", value: "yes" },
    ]);
    await client.signature.decline("doc 1", "assignment 1", "secret", "No");
    await client.assignments.sign("doc 1", "assignment 1", "secret", [
      { itemId: "item", fieldId: "field", pageId: "page", value: "yes" },
    ]);
    await client.assignments.decline("doc 1", "assignment 1", "secret", "No");
    await client.accounts.downloadLogo("acct");
    await client.accounts.uploadLogo("acct", { filename: "logo.png", body: new Uint8Array([1]) });
    await client.signature.upload("secret", new Uint8Array([1]));

    expect(requests[1]!.body).toBeInstanceOf(Blob);
    expect(new URL(requests[2]!.url).searchParams.has("type")).toBe(false);
    expect(requests[10]!.body).toBeInstanceOf(FormData);
    expect(new URL(requests[7]!.url).searchParams.get("signer-access-code")).toBe("secret");
    expect(new URL(requests[9]!.url).pathname).toBe("/v1/accounts/acct/logo");
  });

  it("iterates every signer page", async () => {
    const { client } = makeClient([[{ id: "s1" }]]);
    const ids: string[] = [];
    for await (const signer of client.signers.iterate("acct", { perPage: 1 })) ids.push(signer.id);
    expect(ids).toEqual(["s1"]);
  });

  it("iterates documents across pages and stops at the last one", async () => {
    const pages = [[{ id: "d1" }], [{ id: "d2" }], [{ id: "d3" }]];
    const requested: string[] = [];
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      const page = Number(new URL(url).searchParams.get("page") ?? 1);
      requested.push(`page=${page}`);
      return new Response(JSON.stringify({ status: 200, message: "", data: pages[page - 1] ?? [] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-pagination-current-page": String(page),
          "x-pagination-page-count": String(pages.length),
          "x-pagination-per-page": "1",
          "x-pagination-total-count": String(pages.length),
        },
      });
    });
    const client = new AssinafyClient({
      apiKey: "test-key",
      baseUrl: "https://sandbox.test/v1",
      fetch: fetchImpl as unknown as typeof fetch,
      maxRetries: 0,
    });

    const ids: string[] = [];
    for await (const document of client.documents.iterate("acct", { perPage: 1 })) {
      ids.push(document.id);
    }

    expect(ids).toEqual(["d1", "d2", "d3"]);
    // Stops after the final page rather than requesting a fourth empty one.
    expect(requested).toEqual(["page=1", "page=2", "page=3"]);
  });

  it("resumes iteration from an explicit starting page", async () => {
    const { client, requests } = makeClient([[{ id: "d9" }]]);
    const ids: string[] = [];
    for await (const document of client.documents.iterate("acct", { page: 4, perPage: 1 })) {
      ids.push(document.id);
    }
    expect(ids).toEqual(["d9"]);
    expect(new URL(requests[0]!.url).searchParams.get("page")).toBe("4");
  });
});
