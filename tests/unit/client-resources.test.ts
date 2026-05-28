import { describe, expect, it, vi } from "vitest";
import { AssinafyClient } from "../../src/client/index.js";

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

  it("normalizes assignment signerIds to signer_ids and covers assignment actions", async () => {
    const { client, requests } = makeClient([{}, {}, {}, {}, []]);

    await client.assignments.create("doc 1", { method: "virtual", signerIds: ["s1"] });
    await client.assignments.resendToSigner("doc 1", "asn 1", "s1");
    await client.assignments.estimateResendCost("doc 1", "asn 1", "s1");
    await client.assignments.resetExpiration("doc 1", "asn 1", "2030-08-03T21:00:00Z");
    await client.assignments.whatsappNotifications("doc 1", "asn 1");

    expect(requests[0]!.method).toBe("POST");
    expect(new URL(requests[0]!.url).pathname).toBe("/v1/documents/doc%201/assignments");
    expect(requests[0]!.body).toEqual({ method: "virtual", signer_ids: ["s1"] });
    expect(requests[1]!.method).toBe("PUT");
    expect(new URL(requests[1]!.url).pathname).toBe("/v1/documents/doc%201/assignments/asn%201/signers/s1/resend");
    expect(requests[2]!.method).toBe("POST");
    expect(new URL(requests[2]!.url).pathname).toBe(
      "/v1/documents/doc%201/assignments/asn%201/signers/s1/estimate-resend-cost",
    );
    expect(requests[3]!.method).toBe("PUT");
    expect(new URL(requests[3]!.url).pathname).toBe("/v1/documents/doc%201/assignments/asn%201/reset-expiration");
    expect(requests[3]!.body).toEqual({ expires_at: "2030-08-03T21:00:00Z" });
    expect(requests[4]!.method).toBe("GET");
    expect(new URL(requests[4]!.url).pathname).toBe(
      "/v1/documents/doc%201/assignments/asn%201/whatsapp-notifications",
    );
  });

  it("serializes documented CSV tag filters for documents and templates", async () => {
    const { client, requests } = makeClient([[], []]);

    await client.documents.list("acct", { tags: ["tag1", "tag2"], perPage: 10 });
    await client.templates.list("acct", { tags: ["tag1", "tag2"], sort: "-updated_at" });

    expect(new URL(requests[0]!.url).searchParams.get("tags")).toBe("tag1,tag2");
    expect(new URL(requests[0]!.url).searchParams.get("per-page")).toBe("10");
    expect(new URL(requests[1]!.url).searchParams.get("tags")).toBe("tag1,tag2");
    expect(new URL(requests[1]!.url).searchParams.get("sort")).toBe("-updated_at");
  });

  it("covers field CRUD and validation endpoint shapes", async () => {
    const { client, requests } = makeClient([{}, [], {}, {}, {}, {}, [], []]);

    await client.fields.create("acct", { type: "text", name: "Reference" });
    await client.fields.list("acct", { include_standard: true, include_inactive: true, perPage: 25 });
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
  });
});
