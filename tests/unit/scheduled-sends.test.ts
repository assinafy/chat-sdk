import { describe, expect, it, vi } from "vitest";
import { AssinafyClient, ConfigurationError } from "../../src/client/index.js";

function setup(data: unknown = [], status = 200) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ status, message: "Result", data }), {
    status, headers: { "content-type": "application/json", "x-pagination-current-page": "2", "x-pagination-page-count": "3" },
  }));
  const client = new AssinafyClient({ baseUrl: "https://example.test/v1", apiKey: "test-key", fetch });
  return { client, fetch };
}

const assignment = {
  send_at: 1_900_000_000, expires_at: null, max_total_credits: 0,
  signers: [{ id: "s", sign_as: "Witness" as const, embedded: false }],
};
const envelope = {
  name: "Scheduled envelope", send_at: "2030-01-01T12:00:00Z", message: null,
  max_total_credits: 0, signers: [{ id: "s" }], documents: [{ id: "d", signer_ids: ["s"] }],
};

describe("Scheduled sends and document participants", () => {
  it("preserves capacities for assignment creation, estimates and scheduling while dropping undeclared fields", async () => {
    const { client, fetch } = setup({ id: "job", status: "pending", failure_reason: null });
    const signers = [{ ...assignment.signers[0]!, unexpected: "omit" }];
    await client.assignments.create("d/x", { method: "virtual", signers });
    await client.assignments.estimateCost("d/x", { signers });
    const scheduled = await client.assignments.schedule("d/x", { ...assignment, signers, unexpected: true } as typeof assignment);
    expect(scheduled.failure_reason).toBeNull();
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({ method: "virtual", signers: assignment.signers });
    expect(JSON.parse(String(fetch.mock.calls[1]![1]?.body))).toEqual({ signers: [{ sign_as: "Witness" }] });
    expect(JSON.parse(String(fetch.mock.calls[2]![1]?.body))).toEqual(assignment);
    expect(String(fetch.mock.calls[2]![0])).toBe("https://example.test/v1/documents/d%2Fx/scheduled-sends");
    await client.assignments.schedule("d", { send_at: "2030-01-01T12:00:00Z", signerIds: ["s", "s"], signers: [{ id: "other", sign_as: null }] });
    expect(JSON.parse(String(fetch.mock.calls[3]![1]?.body)).signers).toEqual([{ id: "other", sign_as: null }, { id: "s" }]);
  });

  it("normalizes scheduled field placements and rejects certificate collect before sending", async () => {
    const { client, fetch } = setup();
    const entries = [{ page_id: "p", fields: [{ signer_id: "s", field_id: "f", display_settings: { left: 0, top: 1, width: 2, height: 3, fontSize: 12 } }] }];
    await client.assignments.schedule("d", { ...assignment, method: "collect", entries });
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body)).entries).toEqual(entries);
    await expect(client.assignments.schedule("d", {
      ...assignment, method: "collect", entries, signers: [{ id: "s", verification_method: "DigitalCertificate" }],
    })).rejects.toBeInstanceOf(ConfigurationError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("lists both types with pagination and dispatches or cancels with PUT and no body", async () => {
    const { client, fetch } = setup([{ id: "job", type: "envelope", status: "pending" }]);
    const result = await client.assignments.listScheduledSends("a/b", { document_id: "d/x", page: 2, perPage: 10 });
    expect(result.pagination.pageCount).toBe(3);
    expect(result.data[0]?.type).toBe("envelope");
    await client.assignments.cancelScheduledSend("a/b", "j/x");
    await client.assignments.sendScheduledNow("a/b", "j/x");
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "https://example.test/v1/accounts/a%2Fb/scheduled-sends?document_id=d%2Fx&page=2&per-page=10",
      "https://example.test/v1/accounts/a%2Fb/scheduled-sends/j%2Fx/cancel",
      "https://example.test/v1/accounts/a%2Fb/scheduled-sends/j%2Fx/send",
    ]);
    expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(["GET", "PUT", "PUT"]);
    expect(fetch.mock.calls.every(([, init]) => init?.body === undefined)).toBe(true);
    await expect(client.assignments.listScheduledSends("a", { page: 0 })).rejects.toBeInstanceOf(ConfigurationError);
    await expect(client.assignments.listScheduledSends("a", { perPage: 101 })).rejects.toBeInstanceOf(ConfigurationError);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("schedules an envelope and estimates a reminder without idempotency headers", async () => {
    const { client, fetch } = setup({ total: 0, credit_balance: null, has_sufficient_credits: true, breakdown: [] });
    await client.envelopes.schedule("a/b", { ...envelope, unexpected: true } as typeof envelope);
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual(envelope);
    expect(String(fetch.mock.calls[0]![0])).toBe("https://example.test/v1/accounts/a%2Fb/scheduled-sends");
    const estimate = await client.envelopes.estimateResendCost("a/b", "e/x", "s/y");
    expect(estimate.credit_balance).toBeNull();
    expect(String(fetch.mock.calls[1]![0])).toBe("https://example.test/v1/accounts/a%2Fb/envelopes/e%2Fx/signers/s%2Fy/estimate-resend-cost");
    expect(fetch.mock.calls[1]![1]?.body).toBeUndefined();
    expect(fetch.mock.calls.every(([, init]) => !new Headers(init?.headers).has("Idempotency-Key"))).toBe(true);
  });

  it("keeps notification timestamps and watcher order, supports clearing, and encodes IDs", async () => {
    const history = [{ signer_id: "s", notification_history: [{ sent_at: "2030-01-01T12:00:00Z", delivered_at: null, opened_at: null }] }];
    const { client, fetch } = setup(history);
    expect(await client.assignments.getNotificationHistory("d/x")).toEqual(history);
    await client.assignments.getSignerCapacities("d/x");
    await client.documents.listWatchers("d/x");
    await client.documents.setWatchers("d/x", ["b", "a"]);
    await client.documents.setWatchers("d/x", []);
    expect(fetch.mock.calls.map(([url]) => String(url).split("/d%2Fx/")[1])).toEqual([
      "notification-history", "signer-capacities", "watchers", "watchers", "watchers",
    ]);
    expect(JSON.parse(String(fetch.mock.calls[3]![1]?.body))).toEqual({ watcher_ids: ["b", "a"] });
    expect(JSON.parse(String(fetch.mock.calls[4]![1]?.body))).toEqual({ watcher_ids: [] });
    expect(fetch.mock.calls.every(([, init]) => new Headers(init?.headers).get("X-Api-Key") === "test-key")).toBe(true);
  });

  it.each([409, 500])("preserves HTTP %i and never retries scheduled mutations", async (status) => {
    const { client, fetch } = setup(null, status);
    for (const call of [
      () => client.assignments.schedule("d", assignment),
      () => client.envelopes.schedule("a", envelope),
      () => client.assignments.sendScheduledNow("a", "j"),
      () => client.assignments.cancelScheduledSend("a", "j"),
    ]) await expect(call()).rejects.toMatchObject({ status });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("uses a signature Blob's media type and honors explicit overrides", async () => {
    const { client, fetch } = setup();
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
    await client.signature.upload("code", jpeg);
    await client.signature.upload("code", "initial", jpeg, "image/png", false);
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).get("content-type")).toBe("image/jpeg");
    expect(new Headers(fetch.mock.calls[1]![1]?.headers).get("content-type")).toBe("image/png");
    expect((fetch.mock.calls[1]![1]?.body as Blob).type).toBe("image/png");
    expect(fetch.mock.calls.every(([, init]) => !new Headers(init?.headers).has("X-Api-Key"))).toBe(true);
  });
});
