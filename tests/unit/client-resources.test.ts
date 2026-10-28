import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { AssinafyClient, ConfigurationError, type NotificationPreferences, type UpdateNotificationPreferences } from "../../src/client/index.js";

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

function makeClient(responses: unknown[] = [], accessToken?: string): { client: AssinafyClient; requests: RecordedRequest[] } {
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
    apiKey: accessToken ? undefined : "test-key",
    accessToken,
    accountId: "acct",
    baseUrl: "https://sandbox.test/v1",
    fetch: fetchImpl as unknown as typeof fetch,
    maxRetries: 0,
  });
  return { client, requests };
}

it("limits authentication and user settings to declared request fields", async () => {
  const { client, requests } = makeClient();
  const login = { email: "user@example.com", password: "password", ignored: true };
  const mfa = { mfa_token: "challenge", code: "123456", ignored: true };
  const social = { provider: "google", token: "identity", has_accepted_terms: true, ignored: true };
  const password = { ...login, new_password: "new-password", token: "reset-token" };
  const totp = { id: "method", code: "123456", password: "password", reauth_code: "234567", ignored: true };
  const proof = { password: "password", code: "123456", ignored: true };
  const preferences = { DocumentCompleted: false, ContractRenewed: true, ignored: true };
  await client.auth.login(login);
  await client.auth.verifyMfa(mfa);
  await client.auth.socialLogin(social);
  await client.auth.linkSocialLogin(social);
  await client.auth.changePassword(password);
  await client.auth.requestPasswordReset(login);
  await client.auth.resetPassword(password);
  await client.auth.confirmTotp(totp);
  await client.auth.regenerateRecoveryCodes(proof);
  await client.auth.deleteMfaMethod("method", proof);
  await client.users.updateNotificationPreferences(preferences);
  expect(requests.map(({ body }) => body)).toEqual([
    { email: login.email, password: login.password },
    { mfa_token: mfa.mfa_token, code: mfa.code },
    { provider: social.provider, token: social.token, has_accepted_terms: true },
    { provider: social.provider, token: social.token },
    { email: login.email, password: login.password, new_password: password.new_password },
    { email: login.email },
    { email: login.email, token: password.token, new_password: password.new_password },
    { id: totp.id, code: totp.code, password: totp.password, reauth_code: totp.reauth_code },
    { password: proof.password, code: proof.code },
    { password: proof.password, code: proof.code },
    { DocumentCompleted: false, ContractRenewed: true },
  ]);
  const query = { granularity: "daily" as const, month: "2026-10", ignored: true };
  await client.users.getStats(query);
  expect(Object.fromEntries(new URL(requests.at(-1)!.url).searchParams)).toEqual({ granularity: "daily", month: "2026-10" });
});

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

  it("rejects assignments that the API cannot execute", async () => {
    const { client, requests } = makeClient();

    await expect(
      client.assignments.create("doc", { method: "virtual" } as never),
    ).rejects.toThrow("at least one signer");
    await expect(
      client.assignments.create("doc", {
        method: "collect",
        signers: [{ id: "s1" }],
      } as never),
    ).rejects.toThrow("at least one field entry");
    // `signers` is required for virtual (and an omitted method), `entries` for collect.
    await expect(client.assignments.estimateCost("doc", { method: "virtual" })).rejects.toThrow(
      "at least one signer",
    );
    await expect(client.assignments.estimateCost("doc", {})).rejects.toThrow("at least one signer");
    await expect(
      client.assignments.estimateCost("doc", { method: "collect", signers: [{}] }),
    ).rejects.toThrow("entries for collect");
    expect(requests).toHaveLength(0);
  });

  it("sends only the priced signer settings in an assignment estimate", async () => {
    const { client, requests } = makeClient([{}, {}]);

    await client.assignments.estimateCost("doc", {
      method: "virtual",
      signers: [{ id: "s1", verification_method: "Whatsapp" }],
      signer_ids: ["s1", "s2"],
    });
    await client.assignments.estimateCost("doc", {
      method: "collect",
      entries: [{ page_id: "p1", fields: [] }],
    });

    expect(requests[0]!.body).toEqual({
      method: "virtual",
      signers: [{ verification_method: "Whatsapp" }, {}],
    });
    expect(requests[1]!.body).toEqual({ method: "collect", entries: [{ page_id: "p1", fields: [] }] });
  });

  it("rejects non-virtual digital-certificate assignments with a stable code", async () => {
    const { client, requests } = makeClient();
    const collect = {
      method: "collect" as const,
      signers: [{ verification_method: "DigitalCertificate" as const }],
      entries: [{ page_id: "p1", fields: [] }],
    };

    for (const call of [
      () => client.assignments.create("doc", {
        ...collect,
        signers: [{ id: "s1", verification_method: "DigitalCertificate" }],
      }),
      () => client.assignments.estimateCost("doc", collect),
      () => client.assignments.estimateCost("doc", {
        signers: [{ verification_method: "DigitalCertificate" }],
      }),
    ]) {
      await expect(call()).rejects.toMatchObject({
        code: "DIGITAL_CERTIFICATE_REQUIRES_VIRTUAL",
      });
    }
    expect(requests).toHaveLength(0);
  });

  it.each(["Email", "Whatsapp", "DigitalCertificate", "IdDocumentFaceMatchBasic"])(
    "forwards %s verification and its notification through assignment and template flows",
    async (verification_method) => {
      const { client, requests } = makeClient([{}, {}, {}, {}]);
      const options = { verification_method, notification_methods: [verification_method === "Whatsapp" ? "Whatsapp" : "Email"] };
      await client.assignments.create("d", { method: "virtual", signers: [{ id: "s", ...options }] });
      await client.assignments.estimateCost("d", { method: "virtual", signers: [options] });
      await client.templates.instantiate("acct", "t", { signers: [{ role_id: "r", id: "s", ...options }] });
      await client.templates.estimateCost("acct", "t", { signers: [{ role_id: "r", ...options }] });
      expect(requests.map((request) => (request.body as { signers: unknown[] }).signers)).toEqual([
        [{ id: "s", ...options }], [options], [{ role_id: "r", id: "s", ...options }], [{ role_id: "r", ...options }],
      ]);
    },
  );

  it("omits undeclared assignment and template-estimate properties", async () => {
    const { client, requests } = makeClient([{}, {}]);
    await client.assignments.create("d", {
      method: "virtual", extra: "private", signers: [{ id: "s", extra: "private" }],
    } as never);
    await client.templates.estimateCost("acct", "t", {
      extra: "private", signers: [{ role_id: "r", id: "s", extra: "private" }],
    } as never);
    expect(requests.map((r) => r.body)).toEqual([
      { method: "virtual", signers: [{ id: "s" }] }, { signers: [{ role_id: "r" }] },
    ]);
  });

  it("allowlists collect placements while preserving the estimate's free-form entries", async () => {
    const { client, requests } = makeClient([{}, {}]);
    const entries = [{
      page_id: "p", private: "not-sent",
      fields: [{
        signer_id: "s", field_id: "f", private: "not-sent",
        display_settings: { left: 1, top: 2, width: 3, height: 4, fontSize: 5, backgroundColor: "#ffffff", private: "not-sent" },
      }],
    }];
    await client.assignments.create("d", { method: "collect", signers: [{ id: "s" }], entries });
    await client.assignments.estimateCost("d", { method: "collect", entries });
    expect(requests[0]!.body).toEqual({
      method: "collect", signers: [{ id: "s" }], entries: [{
        page_id: "p", fields: [{
          signer_id: "s", field_id: "f",
          display_settings: { left: 1, top: 2, width: 3, height: 4, fontSize: 5, backgroundColor: "#ffffff" },
        }],
      }],
    });
    expect(requests[1]!.body).toEqual({ method: "collect", entries });
  });

  it("forwards only declared account, signer, tag and webhook body fields", async () => {
    const { client, requests } = makeClient();
    const extra = { private: "not-sent" };
    const account = { name: "Workspace", notification_sender_type: "Account", ...extra };
    const signer = { full_name: "Signer", email: "signer@example.com", whatsapp_phone_number: "+5511999990000", government_id: "123", ...extra };
    const tag = { name: "Tag", color: null, ...extra };
    const endpoint = {
      url: "https://example.com/webhook", email: "ops@example.com", events: ["document_ready"],
      name: "Receiver", is_active: false, signing_enabled: true, ...extra,
    };
    await client.accounts.create(account);
    await client.accounts.update("acct", account);
    await client.signers.create("acct", signer);
    await client.signers.update("acct", "s", signer);
    await client.tags.create("acct", tag);
    await client.tags.update("acct", "t", tag);
    await client.webhooks.createEndpoint("acct", endpoint);
    await client.webhooks.updateEndpoint("acct", "ep", endpoint);
    await client.webhooks.updateSubscription("acct", endpoint);
    expect(requests.map((request) => request.body)).toEqual([
      { name: "Workspace", notification_sender_type: "Account" },
      { name: "Workspace", notification_sender_type: "Account" },
      { full_name: "Signer", email: "signer@example.com", whatsapp_phone_number: "+5511999990000", government_id: "123" },
      { full_name: "Signer", email: "signer@example.com", whatsapp_phone_number: "+5511999990000", government_id: "123" },
      { name: "Tag", color: null }, { name: "Tag", color: null },
      { url: endpoint.url, email: endpoint.email, events: endpoint.events, name: "Receiver", is_active: false, signing_enabled: true },
      { url: endpoint.url, email: endpoint.email, events: endpoint.events, name: "Receiver", is_active: false, signing_enabled: true },
      { url: endpoint.url, email: endpoint.email, events: endpoint.events, is_active: false },
    ]);
    await client.accounts.getStats("acct", { granularity: "daily", month: "2026-10", ...extra });
    expect(new URL(requests[9]!.url).searchParams.has("private")).toBe(false);
  });

  it("allowlists field and signing entries without changing free-form values or nulls", async () => {
    const { client, requests } = makeClient([[], {}]);
    const value = { private: "declared value data", nested: null };
    await client.fields.validateMultiple("acct", [
      { field_id: "f", value, private: "not-sent" },
      { field_id: "g", value: null, private: "not-sent" },
    ] as never);
    await client.assignments.sign("d", "a", "code", [
      { itemId: "i", fieldId: "f", pageId: "p", value: "signed", private: "not-sent" },
    ] as never);
    expect(requests.map((request) => request.body)).toEqual([
      [{ field_id: "f", value }, { field_id: "g", value: null }],
      [{ itemId: "i", fieldId: "f", pageId: "p", value: "signed" }],
    ]);
  });

  it("rejects field and template preparation errors through promises", async () => {
    const { client, requests } = makeClient();
    const calls = [
      () => client.fields.create("acct", null as never),
      () => client.fields.update("acct", "f", null as never),
      () => client.templates.instantiate("acct", "t", { signers: null } as never),
      () => client.templates.estimateCost("acct", "t", { signers: null } as never),
      () => client.accounts.create(null as never),
      () => client.signers.create("acct", null as never),
      () => client.tags.create("acct", null as never),
      () => client.webhooks.createEndpoint("acct", null as never),
    ];
    for (const call of calls) await expect(call()).rejects.toBeInstanceOf(TypeError);
    expect(requests).toHaveLength(0);
  });

  it("covers assignment resend, resend-estimate, reset-expiration, and notifications", async () => {
    const { client, requests } = makeClient([{}, {}, {}, [], {}]);

    await client.assignments.resendToSigner("doc 1", "asn 1", "s1");
    await client.assignments.estimateResendCost("doc 1", "asn 1", "s1");
    await client.assignments.resetExpiration("doc 1", "asn 1", "2030-08-03T21:00:00Z");
    await client.assignments.whatsappNotifications("doc 1", "asn 1");
    await client.assignments.resetExpiration("doc 1", "asn 1", null);
    await expect(
      client.assignments.resetExpiration("doc 1", "asn 1", undefined as unknown as string),
    ).rejects.toThrow(ConfigurationError);

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
    // `null` clears the expiration; the key is always present.
    expect(requests[4]!.body).toEqual({ expires_at: null });
    expect(requests).toHaveLength(5);
  });

  it("serializes CSV document filters and sends only declared template list parameters", async () => {
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
    expect(new URL(requests[1]!.url).searchParams.has("tags")).toBe(false);
    expect(new URL(requests[1]!.url).searchParams.get("sort")).toBe("-updated_at");
  });

  it("preserves resend pricing and ISO WhatsApp notification timestamps", async () => {
    const estimate = { total: 0.45, breakdown: [], credit_balance: null, has_sufficient_credits: true };
    const notification = {
      sent_at: "2026-10-28T12:00:00Z", header: "Signature request", body: "Please sign",
      buttons: [{ text: "Open", url: "https://example.test/sign?code=test-code" }],
      phone_number: "+5511999990000", signer_id: "s1",
    };
    const { client } = makeClient([estimate, [notification]]);
    const cost = await client.assignments.estimateResendCost("d", "a", "s1");
    expect(cost).toEqual(estimate);
    expect(cost.has_sufficient_credits).toBe(true);
    expect(cost.credit_balance).toBeNull();
    const notifications = await client.assignments.whatsappNotifications("d", "a");
    expect(notifications[0]?.sent_at).toBe(notification.sent_at);
    expect(notifications[0]?.buttons[0]?.url).toBe(notification.buttons[0]!.url);
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

  it("sends template signers and editor fields in the published shape", async () => {
    const { client, requests } = makeClient([{}]);

    await client.templates.instantiate("acct", "tpl", {
      signers: [
        { role_id: "r1", id: "s1", step: 1, email: "signer@example.com", full_name: "Legacy" } as never,
        { role_id: "r2", step: 2, email: "new@example.com", name: "New Signer", whatsapp_phone_number: "+5511999990000" },
      ],
      editor_fields: { f1: "value", f2: 42 },
      name: "Contract",
    });

    expect(requests[0]!.body).toEqual({
      signers: [
        { role_id: "r1", id: "s1", step: 1, email: "signer@example.com" },
        { role_id: "r2", step: 2, email: "new@example.com", name: "New Signer", whatsapp_phone_number: "+5511999990000" },
      ],
      editor_fields: [
        { field_id: "f1", value: "value" },
        { field_id: "f2", value: "42" },
      ],
      name: "Contract",
    });
  });

  it("covers field CRUD and validation endpoint shapes", async () => {
    const { client, requests } = makeClient([{}, [], {}, {}, {}, {}, [], []]);

    await client.fields.create("acct", { type: "text", name: "Reference", is_active: true });
    await client.fields.list("acct", { include_standard: true, include_inactive: true });
    await client.fields.get("acct", "field 1");
    await client.fields.update("acct", "field 1", { name: "Reference ID", regex: null, type: "cpf" });
    await client.fields.validate("acct", "field 1", "abc");
    await client.fields.validateMultiple("acct", [{ field_id: "field 1", value: "abc" }]);
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
    expect(requests[0]!.body).toEqual({ type: "text", name: "Reference" });
    expect(requests[3]!.body).toEqual({ name: "Reference ID", regex: null });
    expect(new URL(requests[4]!.url).search).toBe("");
    expect(new Headers(requests[4]!.init.headers).get("x-api-key")).toBe("test-key");
    expect(requests[5]!.body).toEqual([{ field_id: "field 1", value: "abc" }]);
  });

  it("rejects a signer access code on the workspace-only field validation", async () => {
    const { client, requests } = makeClient();

    await expect(client.fields.validate("acct", "f", "x", { accessCode: "code" })).rejects.toThrow(
      ConfigurationError,
    );
    await expect(
      client.fields.validateMultiple("acct", [{ field_id: "f", value: "x" }], { accessCode: "" }),
    ).rejects.toThrow(ConfigurationError);
    expect(requests).toHaveLength(0);
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

  it("covers webhook endpoint and signing-secret paths", async () => {
    const { client, requests } = makeClient([[], {}, {}, {}, [], {}, {}, []]);
    const input = {
      url: "https://example.com/webhook",
      email: "ops@example.com",
      events: ["document_ready"],
      signing_enabled: true,
    };

    await client.webhooks.listEndpoints("acct");
    await client.webhooks.createEndpoint("acct", input);
    await client.webhooks.getEndpoint("acct", "ep 1");
    await client.webhooks.updateEndpoint("acct", "ep 1", { is_active: false });
    await expect(client.webhooks.deleteEndpoint("acct", "ep 1")).resolves.toBeUndefined();
    await client.webhooks.getEndpointSecret("acct", "ep 1");
    await client.webhooks.rotateEndpointSecret("acct", "ep 1");
    await client.webhooks.listDispatches("acct", { endpoint_id: "ep 1" });

    expect(requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "GET /v1/accounts/acct/webhooks/endpoints",
      "POST /v1/accounts/acct/webhooks/endpoints",
      "GET /v1/accounts/acct/webhooks/endpoints/ep%201",
      "PUT /v1/accounts/acct/webhooks/endpoints/ep%201",
      "DELETE /v1/accounts/acct/webhooks/endpoints/ep%201",
      "GET /v1/accounts/acct/webhooks/endpoints/ep%201/secret",
      "POST /v1/accounts/acct/webhooks/endpoints/ep%201/secret/rotate",
      "GET /v1/accounts/acct/webhooks",
    ]);
    expect(requests[1]!.body).toEqual(input);
    expect(requests[3]!.body).toEqual({ is_active: false });
    expect(new URL(requests[7]!.url).searchParams.get("endpoint_id")).toBe("ep 1");
  });

  it("filters webhook endpoints by exact URL and preserves generated secrets for OAuth receivers", async () => {
    const endpoint = { id: "ep", signing_enabled: true, secret: "whsec_test", is_held: false, held_since: null };
    const { client, requests } = makeClient([[], endpoint, endpoint, { secret: "whsec_rotated" }], "workspace-token");
    const url = "https://example.com/webhook?tenant=a+b&key=value";
    await client.webhooks.listEndpoints("account /", { url });
    const created = await client.webhooks.createEndpoint("acct", {
      url, email: "ops@example.com", events: ["document_ready"], signing_enabled: true,
    });
    const updated = await client.webhooks.updateEndpoint("acct", "ep", { signing_enabled: true });
    const rotated = await client.webhooks.rotateEndpointSecret("acct", "ep");
    expect(new URL(requests[0]!.url).pathname).toBe("/v1/accounts/account%20%2F/webhooks/endpoints");
    expect(new URL(requests[0]!.url).searchParams.get("url")).toBe(url);
    expect(created.secret).toBe(endpoint.secret);
    expect(updated.secret).toBe(endpoint.secret);
    expect(created.is_held).toBe(false);
    expect(created.held_since).toBeNull();
    expect(rotated.secret).toBe("whsec_rotated");
    for (const request of requests) {
      expect(new Headers(request.init.headers).get("authorization")).toBe("Bearer workspace-token");
    }
  });

  it("covers two-factor login and enrollment paths", async () => {
    const { client, requests } = makeClient([{ mfa_token: "t" }, {}, {}, {}, {}, {}, {}, { is_mfa_enabled: false }]);

    await expect(client.auth.login({ email: "user@example.com", password: "pw" })).resolves.toEqual({ mfa_token: "t" });
    await client.auth.verifyMfa({ mfa_token: "t", code: "123456" });
    await client.auth.listMfaMethods();
    await client.auth.startTotp();
    await client.auth.startTotp("My phone");
    await client.auth.confirmTotp({ id: "m1", code: "123456" });
    await client.auth.regenerateRecoveryCodes({ password: "pw" });
    await expect(client.auth.deleteMfaMethod("m 1", { code: "ABCD-EFGH-JKMN" }))
      .resolves.toEqual({ is_mfa_enabled: false });

    expect(requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "POST /v1/login",
      "POST /v1/authentication/mfa/verify",
      "GET /v1/users/self/mfa",
      "POST /v1/users/self/mfa/totp",
      "POST /v1/users/self/mfa/totp",
      "PUT /v1/users/self/mfa/totp/confirm",
      "POST /v1/users/self/mfa/recovery-codes",
      "DELETE /v1/users/self/mfa/m%201",
    ]);
    expect(requests[1]!.body).toEqual({ mfa_token: "t", code: "123456" });
    expect(requests[3]!.body).toEqual({});
    expect(requests[4]!.body).toEqual({ label: "My phone" });
    expect(requests[6]!.body).toEqual({ password: "pw" });
    expect(requests[7]!.body).toEqual({ code: "ABCD-EFGH-JKMN" });
    expect(new Headers(requests[7]!.init.headers).get("content-type")).toBe("application/json");
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
    expect([...new URL(requests[1]!.url).searchParams.keys()]).toEqual(["signer-access-code"]);
    expect(requests[2]!.body).toEqual({ document_ids: ["doc1", "doc2"] });
    expect(requests[3]!.body).toEqual({ document_ids: ["doc1"], decline_reason: "No" });
    expect(new URL(requests[4]!.url).pathname).toBe("/v1/signers/signer%201/documents/doc%201/download/original");
    expect(new URL(requests[4]!.url).searchParams.has("signer-access-code")).toBe(false);
  });

  it("rejects invalid pagination before transport", async () => {
    const { client, requests } = makeClient();

    await expect(client.signers.list("acct", { page: 0 })).rejects.toThrow("positive integer");
    await expect(client.documents.list("acct", { perPage: 101 })).rejects.toThrow("between 1 and 100");
    await expect(client.documents.search("acct", { page: 0 })).rejects.toThrow("positive integer");
    await expect(client.assignments.list({ page: 0 })).rejects.toThrow("positive integer");
    await expect(client.tags.list("acct", { page: 0 })).rejects.toThrow("positive integer");
    await expect(client.templates.list("acct", { page: 0 })).rejects.toThrow("positive integer");
    await expect(client.webhooks.listDispatches("acct", { page: 0 })).rejects.toThrow("positive integer");
    await expect(client.signature.listDocuments("signer", "code", { page: 0 })).rejects.toThrow("positive integer");
    expect(requests).toHaveLength(0);
  });

  it("covers signers resource CRUD paths and self confirm-data", async () => {
    const { client, requests } = makeClient([[], {}, {}, {}, {}, {}]);

    await client.signers.list("acct", { search: "alice", perPage: 5 });
    await client.signers.create("acct", { full_name: "Alice", email: "signer@example.test" });
    await client.signers.get("acct", "s 1");
    await client.signers.update("acct", "s 1", { full_name: "Alice B" });
    await client.signers.remove("acct", "s 1");
    await client.signers.confirmDataForDocument("doc 1", "code", {
      government_id: "123",
      whatsapp_phone_number: "+5511999999999",
      has_accepted_terms: true,
    });

    expect(requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "GET /v1/accounts/acct/signers",
      "POST /v1/accounts/acct/signers",
      "GET /v1/accounts/acct/signers/s%201",
      "PUT /v1/accounts/acct/signers/s%201",
      "DELETE /v1/accounts/acct/signers/s%201",
      "PUT /v1/documents/doc%201/signers/confirm-data",
      "PUT /v1/signers/accept-terms",
    ]);
    expect(new URL(requests[0]!.url).searchParams.get("per-page")).toBe("5");
    expect(new URL(requests[5]!.url).searchParams.get("signer-access-code")).toBe("code");
    expect(requests[5]!.body).toEqual({ government_id: "123" });
    expect(new URL(requests[6]!.url).searchParams.get("signer-access-code")).toBe("code");
  });

  it.each(["apiKey", "bearer"])("uses only the signer code for biometric sessions with %s clients", async (kind) => {
    const state = { can_start: true, status: null, url: null, expires_at: null, completed_at: null };
    const session = { id: "iv1", url: "https://example.test/capture#t=opaque", expires_at: null };
    const { client, requests } = makeClient([state, session], kind === "bearer" ? "workspace-token" : undefined);
    const signature = client.signature;

    await expect(signature.getIdentityVerification("code +/?")).resolves.toEqual(state);
    await expect(signature.startIdentityVerification("code +/?", {
      consent: true, extra: "not-sent",
    } as never)).resolves.toEqual(session);

    expect(requests.map((r) => r.method)).toEqual(["GET", "POST"]);
    for (const request of requests) {
      const url = new URL(request.url);
      expect(url.pathname).toBe("/v1/signers/identity-verification");
      expect(url.searchParams.get("signer-access-code")).toBe("code +/?");
      expect(new Headers(request.init.headers).has("authorization")).toBe(false);
      expect(new Headers(request.init.headers).has("x-api-key")).toBe(false);
    }
    expect(requests[0]!.body).toBeUndefined();
    expect(requests[1]!.body).toEqual({ consent: true });
  });

  it("requires explicit biometric consent before making a request", async () => {
    const { client, requests } = makeClient();
    for (const input of [undefined, null, {}, { consent: false }, { consent: "true" }]) {
      await expect(client.signature.startIdentityVerification("code", input as never))
        .rejects.toThrow(ConfigurationError);
    }
    expect(requests).toHaveLength(0);
  });

  it("never retries biometric session creation after a server error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));
    const client = new AssinafyClient({ fetch: fetchImpl as typeof fetch, maxRetries: 2 });
    await expect(client.signature.startIdentityVerification("code", { consent: true }))
      .rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("reads and decides identity reviews with workspace credentials and declared fields only", async () => {
    const review = { id: "iv1", status: "InReview", images: ["face"], evidence_available: true };
    const { client, requests } = makeClient([review, { ...review, status: "Approved" }, { ...review, status: "Declined" }]);
    await expect(client.assignments.getSignerIdentityReview("doc /", "assignment +", "signer ?"))
      .resolves.toEqual(review);
    await client.assignments.reviewSignerIdentity("doc /", "assignment +", "signer ?", {
      decision: "Approved", note: null, extra: "not-sent",
    } as never);
    await client.assignments.reviewSignerIdentity("doc /", "assignment +", "signer ?", { decision: "Rejected" });

    const path = "/v1/documents/doc%20%2F/assignments/assignment%20%2B/signers/signer%20%3F/identity-verification";
    expect(requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      `GET ${path}`, `POST ${path}/review`, `POST ${path}/review`,
    ]);
    expect(requests[1]!.body).toEqual({ decision: "Approved", note: null });
    expect(requests[2]!.body).toEqual({ decision: "Rejected" });
    for (const request of requests) {
      expect(new Headers(request.init.headers).get("x-api-key")).toBe("test-key");
      expect(new URL(request.url).search).toBe("");
    }
  });

  it("validates identity decisions and note length through promise rejection", async () => {
    const { client, requests } = makeClient();
    for (const input of [
      { decision: "Declined" }, { decision: "Approved", note: 1 },
      { decision: "Approved", note: "a".repeat(2001) },
    ]) {
      await expect(client.assignments.reviewSignerIdentity("d", "a", "s", input as never))
        .rejects.toThrow(ConfigurationError);
    }
    expect(requests).toHaveLength(0);
    await client.assignments.reviewSignerIdentity("d", "a", "s", { decision: "Approved", note: "😀".repeat(2000) });
    expect(requests).toHaveLength(1);
  });

  it("returns identity review images as an untouched binary Response", async () => {
    const response = new Response(new Uint8Array([0xff, 0, 0xfe]), {
      headers: { "content-type": "image/jpeg", "cache-control": "no-store" },
    });
    const fetchImpl = vi.fn().mockResolvedValue(response);
    const client = new AssinafyClient({ apiKey: "test-key", fetch: fetchImpl as typeof fetch });
    await expect(client.assignments.downloadSignerIdentityReviewImage("d", "a", "s", "face"))
      .resolves.toBe(response);
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      "https://api.assinafy.com.br/v1/documents/d/assignments/a/signers/s/identity-verification/images/face",
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0xff, 0, 0xfe]));
  });

  it("deletes a webhook endpoint by its exact URL and rejects an empty URL", async () => {
    const { client, requests } = makeClient([[]]);
    const url = "https://example.test/hook?tenant=a+b&key=value#fragment";
    await expect(client.webhooks.deleteEndpointByUrl("account /", url)).resolves.toBeUndefined();
    expect(requests[0]!.method).toBe("DELETE");
    expect(new URL(requests[0]!.url).pathname).toBe("/v1/accounts/account%20%2F/webhooks/endpoints");
    expect(new URL(requests[0]!.url).searchParams.get("url")).toBe(url);
    expect(requests[0]!.body).toBeUndefined();
    for (const value of ["", "  ", undefined]) {
      await expect(client.webhooks.deleteEndpointByUrl("acct", value as never)).rejects.toThrow(ConfigurationError);
    }
    expect(requests).toHaveLength(1);
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

  it("sends the published send-token body and maps the legacy email form", async () => {
    const { client, requests } = makeClient([{}, {}]);

    await client.documents.sendPublicToken("doc 1", { channel: "email", recipient: "signer@example.com" });
    await client.documents.sendPublicToken("doc 1", { email: "signer@example.com" });

    expect(requests[0]!.method).toBe("PUT");
    expect(new URL(requests[0]!.url).pathname).toBe("/v1/public/documents/doc%201/send-token");
    expect(requests[0]!.body).toEqual({ channel: "email", recipient: "signer@example.com" });
    expect(requests[1]!.body).toEqual({ channel: "email", recipient: "signer@example.com" });
  });

  it("rejects send-token requests outside the published contract before transport", async () => {
    const { client, requests } = makeClient();

    await expect(client.documents.sendPublicToken("doc", undefined as never)).rejects.toThrow(ConfigurationError);
    await expect(
      client.documents.sendPublicToken("doc", { channel: "whatsapp", recipient: "+5511999999999" } as never),
    ).rejects.toThrow('only channel "email"');
    await expect(client.documents.sendPublicToken("doc", { channel: "email", recipient: " " })).rejects.toThrow(
      "recipient",
    );
    expect(requests).toHaveLength(0);
  });

  it("never retries a rejected notification request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 400, message: "invalid request", data: null }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new AssinafyClient({
      baseUrl: "https://sandbox.test/v1",
      fetch: fetchImpl as unknown as typeof fetch,
      maxRetries: 2,
    });

    await expect(
      client.documents.sendPublicToken("doc", { channel: "email", recipient: "signer@example.com" }),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("sends signer operations with the access code only and rejects a blank code", async () => {
    const { client, requests } = makeClient([{}, [], []]);

    await client.signature.self("the-code");
    await client.signature.listDocumentsAsWorkspace("signer 1", { search: "nda", status: "certificated" });
    await client.signature.searchDocumentsAsWorkspace("signer 1", "nda");

    const signerHeaders = new Headers(requests[0]!.init.headers);
    expect(signerHeaders.has("x-api-key")).toBe(false);
    expect(signerHeaders.has("authorization")).toBe(false);
    expect(new URL(requests[0]!.url).searchParams.get("signer-access-code")).toBe("the-code");
    for (const request of requests.slice(1)) {
      expect(new Headers(request.init.headers).get("x-api-key")).toBe("test-key");
      expect(new URL(request.url).searchParams.has("signer-access-code")).toBe(false);
    }
    expect(new URL(requests[1]!.url).pathname).toBe("/v1/signers/signer%201/documents");
    expect([...new URL(requests[1]!.url).searchParams.keys()]).toEqual(["search"]);
    expect(new URL(requests[2]!.url).pathname).toBe("/v1/signers/signer%201/documents/search");

    const png = new Uint8Array([1]);
    const blankCodeCalls: Array<(code: string) => Promise<unknown>> = [
      (code) => client.signature.self(code),
      (code) => client.signature.getIdentityVerification(code),
      (code) => client.signature.startIdentityVerification(code, { consent: true }),
      (code) => client.signature.acceptTerms(code),
      (code) => client.signature.verify(code, "123456"),
      (code) => client.signature.upload(code, png),
      (code) => client.signature.download(code, "signature"),
      (code) => client.signature.signContext(code),
      (code) => client.signature.currentDocument("s", code),
      (code) => client.signature.listDocuments("s", code),
      (code) => client.signature.searchDocuments("s", code),
      (code) => client.signature.sign("d", "a", code, []),
      (code) => client.signature.decline("d", "a", code, "no"),
      (code) => client.signature.signMultiple(code, ["d"]),
      (code) => client.signature.declineMultiple(code, ["d"], "no"),
      (code) => client.signers.confirmDataForDocument("d", code, {}),
      (code) => client.assignments.sign("d", "a", code, []),
      (code) => client.assignments.decline("d", "a", code, "no"),
    ];
    for (const call of blankCodeCalls) {
      for (const code of ["", "   ", undefined as unknown as string]) {
        await expect(call(code)).rejects.toThrow(ConfigurationError);
      }
    }
    expect(requests).toHaveLength(3);
  });

  it("covers document search and rename", async () => {
    const { client, requests } = makeClient([[], {}]);

    await client.documents.search("acct", { search: "contract", status: "metadata_ready", sort: "-updated_at", perPage: 5 });
    await client.documents.rename("doc 1", "New Name.pdf");

    expect(requests[0]!.method).toBe("GET");
    expect(new URL(requests[0]!.url).pathname).toBe("/v1/accounts/acct/documents/search");
    expect(new URL(requests[0]!.url).searchParams.get("search")).toBe("contract");
    expect(new URL(requests[0]!.url).searchParams.get("status")).toBe("metadata_ready");
    expect(new URL(requests[0]!.url).searchParams.get("sort")).toBe("-updated_at");
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

  it("preserves contract notification settings and accepts single-setting updates", async () => {
    const legacy: NotificationPreferences = {
      DocumentCompleted: true,
      SignerDeclined: true,
      DocumentCancelled: true,
      DocumentAboutToExpire: true,
      DocumentExpired: true,
      DocumentExpirationReset: true,
      DocumentProcessingFailed: true,
      TemplateProcessingFailed: true,
      SignerWhatsappFailed: true,
    };
    const preferences = {
      ...legacy,
      ContractRenewalNotice: true,
      ContractExpiring: true,
      ContractExpired: true,
      ContractRenewed: false,
    };
    const { client, requests } = makeClient([preferences, preferences]);

    await expect(client.users.getNotificationPreferences()).resolves.toEqual(preferences);
    await expect(client.users.updateNotificationPreferences({ ContractRenewed: false }))
      .resolves.toEqual(preferences);
    expect(requests[1]!.body).toEqual({ ContractRenewed: false });
    expectTypeOf({}).not.toMatchTypeOf<UpdateNotificationPreferences>();
    expectTypeOf<{ ContractRenewed: undefined }>().not.toMatchTypeOf<UpdateNotificationPreferences>();
  });

  it("covers assignments.list and auth.linkSocialLogin", async () => {
    const { client, requests } = makeClient([[], {}]);

    await client.assignments.list({ accountId: "account +/", sort: "-created_at", perPage: 10 });
    await client.auth.linkSocialLogin({ provider: "google", token: "tok" });

    expect(requests[0]!.method).toBe("GET");
    expect(new URL(requests[0]!.url).pathname).toBe("/v1/assignments");
    expect(new URL(requests[0]!.url).searchParams.get("per-page")).toBe("10");
    expect(new URL(requests[0]!.url).searchParams.get("accountId")).toBe("account +/");
    expect(new URL(requests[0]!.url).searchParams.get("sort")).toBe("-created_at");
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
    await client.documents.activities("doc 1", { sort: "-created_at" });
    await client.documents.verify("signature hash");
    await client.documents.publicGet("doc 1");
    await client.documents.sendPublicToken("doc 1", { channel: "email", recipient: "signer@example.com" });
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
    const form = requests[0]!.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    // The upload operation takes a single `file` part; the deprecated tags are not sent.
    expect([...form.keys()]).toEqual(["file"]);
    expect(new URL(requests[5]!.url).searchParams.get("sort")).toBe("-created_at");
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
