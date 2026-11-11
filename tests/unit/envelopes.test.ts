import { describe, expect, it, vi } from "vitest";
import { ConfigurationError, HttpClient } from "../../src/client/index.js";
import { EnvelopesResource } from "../../src/client/envelopes.js";
import type { CreateEnvelopeInput } from "../../src/client/envelope-types.js";

function setup(data: unknown = [], status = 200) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({
    status, message: status === 200 ? "Success" : "Refused", data,
    ...(status === 409 ? { code: "CreditCeilingExceeded" } : {}),
  }), {
    status,
    headers: { "content-type": "application/json", "X-Pagination-Current-Page": "2", "X-Pagination-Page-Count": "3" },
  }));
  const resource = new EnvelopesResource(new HttpClient({
    baseUrl: "https://example.test/v1", auth: { kind: "apiKey", apiKey: "test-key" }, fetch,
  }));
  return { resource, fetch };
}

const input: CreateEnvelopeInput = {
  name: "Service contract", message: null, max_total_credits: 0,
  signers: [{ id: "signer", verification_method: "Email", notification_methods: ["Email"], embedded: false }],
  documents: [{ id: "doc", method: "virtual", signer_ids: ["signer"], expires_at: null, copy_receiver_ids: [] }],
};

describe("EnvelopesResource", () => {
  it("encodes list and activity filters and preserves pagination", async () => {
    const { resource, fetch } = setup([{ id: "envelope", counts: null }]);
    const listed = await resource.list("account/a", { search: "Service", status: "open", page: 2, perPage: 10 });
    const activities = await resource.activities("account/a", "envelope/b", { sort: "id", page: 2, perPage: 10 });
    expect(listed.data).toEqual([{ id: "envelope", counts: null }]);
    expect(listed.pagination.currentPage).toBe(2);
    expect(activities.pagination.pageCount).toBe(3);
    expect(String(fetch.mock.calls[0]![0])).toBe("https://example.test/v1/accounts/account%2Fa/envelopes?search=Service&status=open&page=2&per-page=10");
    expect(String(fetch.mock.calls[1]![0])).toBe("https://example.test/v1/accounts/account%2Fa/envelopes/envelope%2Fb/activities?sort=id&page=2&per-page=10");
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).get("X-Api-Key")).toBe("test-key");
    await expect(resource.list("account", { page: 0 })).rejects.toBeInstanceOf(ConfigurationError);
    await expect(resource.activities("account", "envelope", { perPage: 101 })).rejects.toBeInstanceOf(ConfigurationError);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("omits optional queries and preserves complete envelope responses", async () => {
    const data = { id: "env", counts: null, signing_urls: [{ signer_id: "signer", url: null, embedded: true }] };
    const { resource, fetch } = setup(data);
    expect(await resource.get("account/a", "env/b")).toEqual(data);
    expect(String(fetch.mock.calls[0]![0])).toBe("https://example.test/v1/accounts/account%2Fa/envelopes/env%2Fb");
    const list = setup();
    await list.resource.list("account");
    await list.resource.activities("account", "env");
    expect(String(list.fetch.mock.calls[0]![0])).not.toContain("?");
    expect(String(list.fetch.mock.calls[1]![0])).not.toContain("?");
  });

  it("creates and estimates only declared fields, preserving embedded false, null and a zero ceiling", async () => {
    const { resource, fetch } = setup({ id: "env" });
    const extended = {
      ...input, ignored: true,
      signers: input.signers.map((signer) => ({ ...signer, step: 2, ignored: true })),
      documents: input.documents.map((document) => ({ ...document, ignored: true })),
    };
    await resource.create("account", extended, { idempotencyKey: "unique-key" });
    await resource.estimateCost("account", extended);
    await resource.create("account", input);
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual(input);
    expect(JSON.parse(String(fetch.mock.calls[1]![1]?.body))).toEqual(input);
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).get("Idempotency-Key")).toBe("unique-key");
    expect(new Headers(fetch.mock.calls[1]![1]?.headers).has("Idempotency-Key")).toBe(false);
    expect(new Headers(fetch.mock.calls[2]![1]?.headers).has("Idempotency-Key")).toBe(false);
    expect(String(fetch.mock.calls[1]![0])).toMatch(/\/envelopes\/estimate-cost$/);
  });

  it("normalizes collect placements for creation and document addition without extra fields", async () => {
    const { resource, fetch } = setup({ id: "env" });
    const display = { left: 0, top: 0, width: 30, height: 20, fontSize: 12, fontFamily: "Arial", backgroundColor: "#ffffff" };
    const entries = [{ page_id: "page", fields: [{ signer_id: "signer", field_id: "field", display_settings: display }] }];
    const extended = [{ ...entries[0]!, ignored: true, fields: [{ ...entries[0]!.fields[0]!, ignored: true, display_settings: { ...display, ignored: true } }] }];
    const document = { id: "doc", method: "collect" as const, entries: extended, signer_ids: ["signer"], expires_at: 0 };
    await resource.create("account", { ...input, documents: [document] });
    await resource.addDocument("account/a", "env/b", { ...document, max_total_credits: 0 });
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body)).documents).toEqual([{ ...document, entries }]);
    expect(JSON.parse(String(fetch.mock.calls[1]![1]?.body))).toEqual({ ...document, entries, max_total_credits: 0 });
    expect(String(fetch.mock.calls[1]![0])).toBe("https://example.test/v1/accounts/account%2Fa/envelopes/env%2Fb/documents");
  });

  it("updates, cancels, reminds, removes documents and deletes with the declared verbs", async () => {
    const { resource, fetch } = setup({ id: "env" });
    const update = { name: "New name", message: null, document_ids: ["doc2", "doc1"], ignored: true };
    await resource.update("account/a", "env/b", update);
    await resource.cancel("account/a", "env/b");
    await resource.resendToSigner("account/a", "env/b", "signer/c");
    expect(await resource.removeDocument("account/a", "env/b", "doc/d")).toEqual({ id: "env" });
    expect(await resource.remove("account/a", "env/b")).toBeUndefined();
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({ name: "New name", message: null, document_ids: ["doc2", "doc1"] });
    expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(["PATCH", "PUT", "PUT", "DELETE", "DELETE"]);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "https://example.test/v1/accounts/account%2Fa/envelopes/env%2Fb",
      "https://example.test/v1/accounts/account%2Fa/envelopes/env%2Fb/cancel",
      "https://example.test/v1/accounts/account%2Fa/envelopes/env%2Fb/signers/signer%2Fc/resend",
      "https://example.test/v1/accounts/account%2Fa/envelopes/env%2Fb/documents/doc%2Fd",
      "https://example.test/v1/accounts/account%2Fa/envelopes/env%2Fb",
    ]);
  });

  it("returns the raw ZIP response", async () => {
    const { resource, fetch } = setup();
    fetch.mockResolvedValueOnce(new Response("zip bytes", { headers: { "content-type": "application/zip" } }));
    const response = await resource.download("account/a", "env/b", "certificate-page");
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(await response.text()).toBe("zip bytes");
    expect(String(fetch.mock.calls[0]![0])).toBe("https://example.test/v1/accounts/account%2Fa/envelopes/env%2Fb/download/certificate-page");
  });

  it.each([409, 500])("preserves HTTP %i and never retries creation, including with an idempotency key", async (status) => {
    const { resource, fetch } = setup(null, status);
    await expect(resource.create("account", input, { idempotencyKey: "key" })).rejects.toMatchObject({ status });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
