/**
 * Explicitly gated production lifecycle checks. Every write targets a resource
 * created by this suite; no signature invitations or verification sessions run.
 */
import { setTimeout as delay } from "node:timers/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, describe, expect, it, type TestContext } from "vitest";
import { ApiError, AssinafyClient, type Document } from "../../src/client/index.js";
import { createLiveFetch, makeMinimalPdf } from "../setup.js";

const enabled = process.env.ASSINAFY_TEST_PRODUCTION === "1";
const apiKey = process.env.ASSINAFY_PRODUCTION_API_KEY;
const accountId = process.env.ASSINAFY_PRODUCTION_ACCOUNT_ID ?? "";
if (enabled && (!apiKey || !accountId)) {
  throw new Error("Production tests require ASSINAFY_PRODUCTION_API_KEY and ASSINAFY_PRODUCTION_ACCOUNT_ID");
}

const describeProduction = enabled ? describe.sequential : describe.skip;

describeProduction("Assinafy API — opt-in disposable production resources", () => {
  const runId = `sdk-test-${crypto.randomUUID()}`;
  const pacedFetch = createLiveFetch(2_000);
  const requestScope = new AsyncLocalStorage<AbortSignal>();
  const client = new AssinafyClient({
    baseUrl: "https://api.assinafy.com.br/v1",
    apiKey,
    accountId,
    maxRetries: 0,
    fetch: (input, init) => pacedFetch(input, {
      ...init,
      signal: AbortSignal.any([
        AbortSignal.timeout(20_000),
        ...(requestScope.getStore() ? [requestScope.getStore()!] : []),
        ...(init?.signal ? [init.signal] : []),
      ]),
    }),
  });
  const cleanup: Array<() => Promise<void>> = [];

  afterAll(() => requestScope.run(AbortSignal.timeout(170_000), async () => {
    const failures: unknown[] = [];
    for (const remove of cleanup.reverse()) {
      try {
        await remove();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, "Disposable production resource cleanup failed");
  }), 180_000);

  function liveTest(name: string, run: (context: TestContext) => Promise<void>): void {
    it(name, (context) => requestScope.run(context.signal, () => run(context)), 120_000);
  }

  /** Do not print production identifiers, response bodies, or credential-bearing errors. */
  async function request<T>(label: string, call: () => Promise<T>): Promise<T> {
    try {
      requestScope.getStore()?.throwIfAborted();
      return await call();
    } catch (error) {
      // eslint-disable-next-line preserve-caught-error -- API errors can contain private IDs and bearer URLs.
      throw new Error(error instanceof ApiError
        ? `Production ${label}: HTTP ${error.status}, retry-after ${error.retryAfterSeconds ?? "none"}, remaining ${error.rateLimit?.remaining ?? "unknown"}`
        : `Production ${label}: request failed before a usable response`);
    }
  }

  function retain(remove: () => Promise<void>): () => Promise<void> {
    let pending = true;
    const once = async () => {
      if (!pending) return;
      await remove();
      pending = false;
    };
    cleanup.push(once);
    return once;
  }

  async function statusOf(call: () => Promise<unknown>): Promise<number> {
    try {
      await call();
      return 200;
    } catch (error) {
      if (error instanceof ApiError) return error.status;
      // eslint-disable-next-line preserve-caught-error -- Keep response-bearing causes out of test output.
      throw new Error("Production expected-status check failed before a usable response");
    }
  }

  async function waitForDocument(documentId: string, requirePages: boolean): Promise<Document> {
    const deadline = Date.now() + 45_000;
    do {
      const document = await request("draft metadata read", () => client.documents.get(documentId));
      if (!["uploading", "uploaded", "metadata_processing"].includes(document.status)) {
        if (requirePages && !document.pages?.length) throw new Error("Draft processing completed without a page");
        return document;
      }
      await delay(1_500, undefined, { signal: requestScope.getStore() });
    } while (Date.now() < deadline);
    throw new Error("Draft metadata processing exceeded 45 seconds");
  }

  async function createDocument(label: string) {
    const uploaded = await request("draft upload", () => client.documents.upload(accountId, {
      filename: `${runId}-${label}.pdf`,
      body: makeMinimalPdf("SDK disposable production test"),
      contentType: "application/pdf",
    }));
    expect(typeof uploaded.id === "string" && uploaded.id.length > 0).toBe(true);
    const remove = retain(async () => {
      await waitForDocument(uploaded.id, false);
      await request("draft deletion", () => client.documents.remove(uploaded.id));
    });
    return { document: await waitForDocument(uploaded.id, true), remove };
  }

  liveTest("reads the current user, workspace, statistics and notification preferences", async () => {
    const user = await request("user profile", () => client.users.getCurrent());
    expect(typeof user.id === "string" && user.id.length > 0).toBe(true);
    const accounts = await request("workspace list", () => client.accounts.list());
    expect(accounts.some((account) => account.id === accountId)).toBe(true);
    const account = await request("workspace detail", () => client.accounts.get(accountId));
    expect(account.id === accountId).toBe(true);
    expect(Array.isArray(await request("workspace statistics", () => client.accounts.getStats(accountId)))).toBe(true);
    expect(Array.isArray(await request("user statistics", () => client.users.getStats()))).toBe(true);
    const preferences = await request("notification preferences", () => client.users.getNotificationPreferences());
    for (const key of [
      "DocumentCompleted", "SignerDeclined", "DocumentCancelled", "DocumentAboutToExpire",
      "DocumentExpired", "DocumentExpirationReset", "DocumentProcessingFailed",
      "TemplateProcessingFailed", "SignerWhatsappFailed", "ContractRenewalNotice",
      "ContractExpiring", "ContractExpired", "ContractRenewed",
    ] as const) {
      expect(typeof preferences[key]).toBe("boolean");
    }
  });

  liveTest("reads a template detail when the workspace has an existing template", async ({ skip }) => {
    const templates = await request("template list", () => client.templates.list(accountId, { perPage: 1 }));
    expect(Array.isArray(templates.data)).toBe(true);
    if (!templates.data.length) skip("No existing template is available for a read-only detail check");
    const template = templates.data[0]!;
    const detail = await request("template detail", () => client.templates.get(accountId, template.id));
    expect(detail.id === template.id).toBe(true);
  });

  liveTest("uploads, reads, downloads, renames and deletes its own draft document", async () => {
    const { document, remove } = await createDocument("document");
    expect(document.status).toBe("metadata_ready");
    const listed = await request("draft list", () => client.documents.list(accountId, {
      search: `${runId}-document`, perPage: 10,
    }));
    expect(listed.data.some((item) => item.id === document.id)).toBe(true);
    const searched = await request("draft search", () => client.documents.search(accountId, {
      search: `${runId}-document`, sort: "-created_at", perPage: 10,
    }));
    expect(searched.data.some((item) => item.id === document.id)).toBe(true);
    const original = await request("original download", () => client.documents.download(document.id, "original"));
    expect((await request("original response body", () => original.arrayBuffer())).byteLength).toBeGreaterThan(0);
    const page = await request("page download", () => client.documents.downloadPage(document.id, document.pages![0]!.id));
    expect((await request("page response body", () => page.arrayBuffer())).byteLength).toBeGreaterThan(0);
    const thumbnail = await request("thumbnail download", () => client.documents.thumbnail(document.id));
    expect((await request("thumbnail response body", () => thumbnail.arrayBuffer())).byteLength).toBeGreaterThan(0);
    const name = `${runId}-renamed.pdf`;
    const renamed = await request("draft rename", () => client.documents.rename(document.id, name));
    expect(renamed.name).toBe(name);
    const activities = await request("draft activities", () => client.documents.activities(document.id, { sort: "-created_at" }));
    expect(Array.isArray(activities)).toBe(true);
    await remove();
    expect(await statusOf(() => client.documents.get(document.id))).toBe(404);
  });

  liveTest("estimates Email, Whatsapp, DigitalCertificate and biometric signing without sending", async () => {
    const { document, remove } = await createDocument("estimates");
    const failures: unknown[] = [];
    for (const verification_method of ["Email", "Whatsapp", "DigitalCertificate", "IdDocumentFaceMatchBasic"] as const) {
      try {
        const cost = await request(`${verification_method} estimate`, () => client.assignments.estimateCost(document.id, {
          method: "virtual",
          signers: [{
            verification_method,
            notification_methods: [verification_method === "Whatsapp" ? "Whatsapp" : "Email"],
          }],
        }));
        expect(typeof cost.has_sufficient_resources).toBe("boolean");
        expect(Array.isArray(cost.breakdown)).toBe(true);
      } catch (error) {
        failures.push(error);
      }
    }
    await remove();
    if (failures.length) throw new AggregateError(failures, "Production signing estimates failed");
  });

  liveTest("tracks, links and terminates contract terms on its own drafts", async () => {
    const root = await createDocument("contract");
    const endDate = new Date(Date.now() + 730 * 86_400_000).toISOString().slice(0, 10);
    const contract = await request("contract creation", () => client.contracts.update(accountId, root.document.id, {
      status: "active",
      counterparty_name: "SDK disposable contract",
      value: 12.34,
      currency: "BRL",
      start_date: new Date(Date.now() + 366 * 86_400_000).toISOString().slice(0, 10),
      end_date: endDate,
      auto_renew: false,
      notice_period_days: null,
      external_references: [{ system: "chat-sdk-test", id: runId }],
      metadata: { sdk_test: runId },
    }));
    expect(contract.resource).toBe("document_contract");
    if (contract.resource !== "document_contract") throw new Error("Expected standalone contract terms");
    expect(contract.status).toBe("active");
    expect(contract.auto_renew).toBe(false);
    expect(contract.notice_period_days).toBeNull();
    const fetched = await request("contract detail", () => client.contracts.get(accountId, root.document.id));
    expect(fetched.document_id === root.document.id).toBe(true);
    const updated = await request("contract partial update", () => client.contracts.update(accountId, root.document.id, {
      metadata: { sdk_test: runId, stage: "updated" }, updated_at: fetched.updated_at,
    }));
    if (updated.resource !== "document_contract") throw new Error("Expected standalone contract after update");
    expect(updated.metadata?.stage).toBe("updated");
    const listed = await request("contract list", () => client.contracts.list(accountId, {
      external_system: "chat-sdk-test", external_id: runId, expand: "document", perPage: 10,
    }));
    expect(listed.data.some((item) => item.document_id === root.document.id && item.document?.id === root.document.id)).toBe(true);

    expect(await statusOf(() => client.contracts.update(accountId, root.document.id, {
      counterparty_name: "This stale write must not apply",
      updated_at: "2000-01-01T00:00:00Z",
    }))).toBe(409);
    const afterConflict = await request("contract after conflict", () => client.contracts.get(accountId, root.document.id));
    if (afterConflict.resource !== "document_contract") throw new Error("Expected standalone contract after conflict");
    expect(afterConflict.counterparty_name).toBe("SDK disposable contract");

    const child = await createDocument("amendment");
    const amendment = await request("pending amendment link", () => client.contracts.update(accountId, child.document.id, {
      parent_document_id: root.document.id, relation_type: "amendment", value: 18.5,
    }));
    const unlink = retain(async () => {
      await request("pending amendment unlink", () => client.contracts.update(accountId, child.document.id, {
        parent_document_id: null,
      }));
    });
    expect(amendment.resource).toBe("document_contract_amendment");
    expect(amendment.status).toBe("pending");
    const related = await request("contract family", () => client.contracts.related(accountId, child.document.id));
    expect(related.document_id === root.document.id).toBe(true);
    expect(related.value).toBe(12.34);
    expect(related.amendments?.some((item) => item.document_id === child.document.id)).toBe(true);
    await unlink();
    const detached = await request("contract family after unlink", () => client.contracts.related(accountId, root.document.id));
    expect(detached.amendments?.some((item) => item.document_id === child.document.id) ?? false).toBe(false);

    const terminated = await request("contract termination", () => client.contracts.terminate(accountId, root.document.id, {
      reason: "SDK disposable lifecycle test", updated_at: detached.updated_at,
    }));
    expect(terminated.status).toBe("terminated");
    expect(Array.isArray(await request("contract activities", () => client.documents.activities(root.document.id)))).toBe(true);
    await child.remove();
    await root.remove();
  });

  liveTest("renews a disposable contract when owner notifications are explicitly enabled", async ({ skip }) => {
    if (process.env.ASSINAFY_TEST_NOTIFICATIONS !== "1") {
      skip("Contract renewal may email the owner; requires ASSINAFY_TEST_NOTIFICATIONS=1");
    }
    const root = await createDocument("renewal");
    const contract = await request("renewal fixture", () => client.contracts.update(accountId, root.document.id, {
      status: "active",
      end_date: new Date(Date.now() + 730 * 86_400_000).toISOString().slice(0, 10),
      auto_renew: false,
      notice_period_days: null,
      value: 12.34,
      currency: "BRL",
    }));
    if (contract.resource !== "document_contract") throw new Error("Expected standalone contract for renewal");
    const renewalDate = new Date(Date.now() + 1_095 * 86_400_000).toISOString().slice(0, 10);
    const renewed = await request("contract renewal", () => client.contracts.renew(accountId, root.document.id, {
      term: contract.term, end_date: renewalDate, value: null, updated_at: contract.updated_at,
    }));
    expect(renewed.term).toBe(contract.term + 1);
    expect(renewed.end_date).toBe(renewalDate);
    expect(renewed.value).toBeNull();
    expect(renewed.auto_renew).toBe(false);
    await root.remove();
  });

  liveTest("creates, reads, updates and deletes a disposable signer without inviting them", async () => {
    const signer = await request("signer creation", () => client.signers.create(accountId, {
      full_name: "SDK Disposable Signer", email: `${runId}@example.com`,
    }));
    const remove = retain(() => request("signer deletion", () => client.signers.remove(accountId, signer.id)));
    const fetched = await request("signer detail", () => client.signers.get(accountId, signer.id));
    expect(fetched.id === signer.id).toBe(true);
    const updated = await request("signer update", () => client.signers.update(accountId, signer.id, {
      full_name: "SDK Disposable Signer Updated",
    }));
    expect(updated.full_name).toBe("SDK Disposable Signer Updated");
    await remove();
  });

  liveTest("creates, validates, updates and deletes a disposable field", async () => {
    const field = await request("field creation", () => client.fields.create(accountId, {
      name: runId, type: "text", regex: "/^[A-Z0-9-]+$/",
    }));
    const remove = retain(() => request("field deletion", () => client.fields.remove(accountId, field.id)));
    const fetched = await request("field detail", () => client.fields.get(accountId, field.id));
    expect(fetched.id === field.id).toBe(true);
    const valid = await request("field validation", () => client.fields.validate(accountId, field.id, "SDK-123"));
    expect(valid.success).toBe(true);
    const updated = await request("field update", () => client.fields.update(accountId, field.id, { name: `${runId}-updated` }));
    expect(updated.name).toBe(`${runId}-updated`);
    await remove();
  });

  liveTest("creates, finds, updates and deletes a disposable tag", async () => {
    const tag = await request("tag creation", () => client.tags.create(accountId, { name: runId, color: "#888888" }));
    const remove = retain(async () => {
      await request("tag deletion", () => client.tags.remove(accountId, tag.id));
    });
    const listed = await request("tag list", () => client.tags.list(accountId, { search: runId, perPage: 10 }));
    expect(listed.data.some((item) => item.id === tag.id)).toBe(true);
    const updated = await request("tag update", () => client.tags.update(accountId, tag.id, { name: `${runId}-updated` }));
    expect(updated.name).toBe(`${runId}-updated`);
    await remove();
  });
});
