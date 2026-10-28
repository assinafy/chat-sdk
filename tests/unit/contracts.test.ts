import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  AssinafyClient,
  ConfigurationError,
  ContractsResource,
  type DocumentContractInput,
  type RenewContractInput,
} from "../../src/client/index.js";

function setup(data: unknown = [], status = 200) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({
    status, message: status === 200 ? "Success" : "Contract changed",
    data,
    ...(status === 409 ? { code: "ContractChanged" } : {}),
  }), {
    status,
    headers: { "content-type": "application/json" },
  }));
  const client = new AssinafyClient({ baseUrl: "https://example.test/v1", apiKey: "test-key", fetch });
  return { client, fetch };
}

describe("ContractsResource", () => {
  it("exports the resource and sends every list filter with pagination", async () => {
    const { client, fetch } = setup([{ resource: "document_contract", document_id: "doc" }]);
    expect(client.contracts).toBeInstanceOf(ContractsResource);
    const result = await client.contracts.list("account/space", {
      status: ["active", "expired"], counterparty: "Example", search: "Service",
      end_date_from: "2026-10-01", end_date_to: "2027-10-01", ending_within_days: 0,
      external_system: "crm", external_id: "record/1", sort: "-updated_at",
      expand: "document", page: 2, perPage: 10,
    });
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.pathname).toBe("/v1/accounts/account%2Fspace/contracts");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: "active,expired", counterparty: "Example", search: "Service",
      end_date_from: "2026-10-01", end_date_to: "2027-10-01", ending_within_days: "0",
      external_system: "crm", external_id: "record/1", sort: "-updated_at",
      expand: "document", page: "2", "per-page": "10",
    });
    expect(result.data).toEqual([{ resource: "document_contract", document_id: "doc" }]);
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).get("X-Api-Key")).toBe("test-key");
  });

  it("omits absent filters and rejects invalid pagination through a promise", async () => {
    const { client, fetch } = setup();
    await client.contracts.list("account");
    expect(String(fetch.mock.calls[0]![0])).toBe("https://example.test/v1/accounts/account/contracts");
    const promise = client.contracts.list("account", { perPage: 101 });
    await expect(promise).rejects.toBeInstanceOf(ConfigurationError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["document_contract", "document_contract_amendment"])("preserves %s responses", async (resource) => {
    const data = { resource, document_id: "doc", terms: null, apply_error: null, updated_at: "2026-10-28T12:00:00Z" };
    const { client, fetch } = setup(data);
    expect(await client.contracts.get("account/a", "doc/b")).toEqual(data);
    expect(String(fetch.mock.calls[0]![0])).toBe("https://example.test/v1/accounts/account%2Fa/documents/doc%2Fb/contract");
    expect(await client.contracts.related("account", "doc")).toEqual(data);
    expect(String(fetch.mock.calls[1]![0])).toMatch(/\/contract\/related$/);
  });

  it("sends only declared update fields, preserving null, false, zero and the conflict precondition", async () => {
    const { client, fetch } = setup({ resource: "document_contract_amendment" });
    const input = {
      status: "draft", counterparty_name: null, counterparty_taxpayer_id: null,
      value: 0, currency: "BRL", start_date: null, end_date: "2027-10-28",
      auto_renew: false, renewal_term_months: null, notice_period_days: 0,
      owner_id: null, metadata: { crm_stage: "won" },
      external_references: [{ system: "crm", id: "record", extra: "discard" }],
      parent_document_id: "parent", relation_type: "amendment", updated_at: "2026-10-28T12:00:00Z",
      ignored: "discard",
    };
    const result = await client.contracts.update("account", "doc", input as DocumentContractInput);
    expect(result.resource).toBe("document_contract_amendment");
    expect(fetch.mock.calls[0]![1]?.method).toBe("PUT");
    const { ignored: _ignored, ...expected } = input;
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({
      ...expected, external_references: [{ system: "crm", id: "record" }],
    });
    await client.contracts.update("account", "doc", { external_references: null, parent_document_id: null });
    expect(JSON.parse(String(fetch.mock.calls[1]![1]?.body))).toEqual({ external_references: null, parent_document_id: null });
    await client.contracts.update("account", "doc", { external_references: [] });
    expect(JSON.parse(String(fetch.mock.calls[2]![1]?.body))).toEqual({ external_references: [] });
  });

  it("renews by current term or later date and terminates with only declared fields", async () => {
    const { client, fetch } = setup({ resource: "document_contract", term: 2 });
    expect(await client.contracts.renew("account", "doc", { term: 1, value: null })).toMatchObject({ term: 2 });
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({ term: 1, value: null });
    await client.contracts.renew("account", "doc", { end_date: "2028-10-28", value: 0, updated_at: "2026-10-28T12:00:00Z" });
    expect(JSON.parse(String(fetch.mock.calls[1]![1]?.body))).toEqual({ end_date: "2028-10-28", value: 0, updated_at: "2026-10-28T12:00:00Z" });
    await client.contracts.terminate("account", "doc", { reason: null, updated_at: "2026-10-28T12:00:00Z" });
    expect(JSON.parse(String(fetch.mock.calls[2]![1]?.body))).toEqual({ reason: null, updated_at: "2026-10-28T12:00:00Z" });
    await client.contracts.terminate("account", "doc");
    expect(JSON.parse(String(fetch.mock.calls[3]![1]?.body))).toEqual({});
    expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "POST", "POST", "POST"]);
    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname.split("/").at(-1)))
      .toEqual(["renew", "renew", "terminate", "terminate"]);
  });

  it.each([{}, { term: 0 }, { term: 1.5 }, { end_date: " " }])("rejects unsafe renewal %j before fetch", async (input) => {
    const { client, fetch } = setup();
    await expect(client.contracts.renew("account", "doc", input as RenewContractInput)).rejects.toBeInstanceOf(ConfigurationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([400, 403, 409, 500])("preserves error %i and never retries contract mutations", async (status) => {
    const { client, fetch } = setup(null, status);
    for (const mutation of [
      () => client.contracts.update("account", "doc", { value: 1 }),
      () => client.contracts.renew("account", "doc", { term: 1 }),
      () => client.contracts.terminate("account", "doc"),
    ]) {
      await expect(mutation()).rejects.toMatchObject({
        status,
        ...(status === 409 ? { body: { code: "ContractChanged" } } : {}),
      });
    }
    expect(fetch).toHaveBeenCalledTimes(3);
    await expect(client.contracts.update("account", "doc", { value: 1 })).rejects.toBeInstanceOf(ApiError);
  });
});
