/** Opt-in production checks without invitations, signing, or verification sessions. */
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";
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

describeProduction("Assinafy API — usage, envelopes, embed origins and webhook rotation", () => {
  const runId = `sdk-test-${crypto.randomUUID()}`;
  const pacedFetch = createLiveFetch(2_000);
  const requestScope = new AsyncLocalStorage<AbortSignal>();
  const options = {
    baseUrl: "https://api.assinafy.com.br/v1",
    maxRetries: 0,
    fetch: (input: RequestInfo | URL, init?: RequestInit) => pacedFetch(input, {
      ...init,
      signal: AbortSignal.any([
        AbortSignal.timeout(20_000),
        ...(requestScope.getStore() ? [requestScope.getStore()!] : []),
        ...(init?.signal ? [init.signal] : []),
      ]),
    }),
  };
  const client = new AssinafyClient({ ...options, apiKey, accountId });
  const anonymous = new AssinafyClient(options);
  const cleanup: Array<() => Promise<void>> = [];

  afterAll(() => requestScope.run(AbortSignal.timeout(170_000), async () => {
    const failures: unknown[] = [];
    for (const remove of cleanup.reverse()) {
      try { await remove(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, "Disposable production resource cleanup failed");
  }), 180_000);

  function liveTest(name: string, run: (context: TestContext) => Promise<void>): void {
    it(name, (context) => requestScope.run(context.signal, () => run(context)), 120_000);
  }

  /** Keep response bodies, identifiers and bearer credentials out of failure output. */
  async function request<T>(label: string, call: () => Promise<T>, unavailable?: TestContext): Promise<T> {
    try {
      requestScope.getStore()?.throwIfAborted();
      return await call();
    } catch (error) {
      if (unavailable && error instanceof ApiError && error.status === 403) {
        unavailable.skip(`${label} is unavailable to this production account (HTTP 403)`);
      }
      // eslint-disable-next-line preserve-caught-error -- API errors can contain private response data.
      throw new Error(error instanceof ApiError
        ? `Production ${label}: HTTP ${error.status}, retry-after ${error.retryAfterSeconds ?? "none"}`
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
    return request("expected-status check", async () => {
      try { await call(); return 200; } catch (error) {
        if (error instanceof ApiError) return error.status;
        throw error;
      }
    });
  }

  async function processedDocument(id: string): Promise<Document> {
    const deadline = Date.now() + 45_000;
    do {
      const document = await request("draft status", () => client.documents.get(id));
      if (!["uploading", "uploaded", "metadata_processing"].includes(document.status)) return document;
      await delay(1_500, undefined, { signal: requestScope.getStore() });
    } while (Date.now() < deadline);
    throw new Error("Draft metadata processing exceeded 45 seconds");
  }

  liveTest("reads usage, signing features, workspace notification policy and push settings", async () => {
    const usage = await request("workspace usage", () => client.accounts.getUsage(accountId));
    expect(usage.plan === null || typeof usage.plan === "string").toBe(true);
    expect(usage.documents_renewal_date === null || typeof usage.documents_renewal_date === "string").toBe(true);
    for (const balance of [usage.balances.documents, usage.balances.credits]) {
      expect(balance.balance === null || typeof balance.balance === "number").toBe(true);
      expect(balance.limit === null || typeof balance.limit === "number").toBe(true);
      expect(typeof balance.spent).toBe("number");
    }
    const account = await request("signing features", () => client.accounts.get(accountId, { expand: "signing_features" }));
    for (const feature of ["DigitalCertificate", "VerificationIdDocumentFaceMatchBasic", "WhatsappNotification", "VerificationBypass", "Embed"] as const) {
      expect(typeof account.signing_features?.[feature]).toBe("boolean");
    }
    const policy = await request("notification policy", () => client.accounts.getNotificationPolicy(accountId));
    expect(typeof policy.editable).toBe("boolean");
    expect(typeof policy.owners_receive_all).toBe("boolean");
    expect(Object.keys(policy.events).length > 0).toBe(true);
    expect(Object.values(policy.events).every((value) => typeof value === "boolean")).toBe(true);
    const preferences = await request("push preferences", () => client.users.getPushPreferences());
    for (const key of ["SignerViewed", "SignerSigned", "DocumentCompleted", "SignerDeclined", "DocumentAboutToExpire", "DocumentExpired", "SignerIdentityReviewRequired", "SignerWhatsappFailed"] as const) {
      expect(typeof preferences[key]).toBe("boolean");
    }
  });

  liveTest("lists envelopes and estimates a disposable draft without creating an invitation", async (context) => {
    const listed = await request("envelope list", () => client.envelopes.list(accountId, { search: runId, perPage: 1 }));
    expect(Array.isArray(listed.data)).toBe(true);
    const signer = await request("estimate signer creation", () => client.signers.create(accountId, {
      full_name: "SDK Disposable Signer", email: `${runId}@example.com`,
    }));
    const removeSigner = retain(() => request("estimate signer deletion", () => client.signers.remove(accountId, signer.id)));
    const uploaded = await request("estimate draft upload", () => client.documents.upload(accountId, {
      filename: `${runId}.pdf`, body: makeMinimalPdf("SDK envelope estimate"), contentType: "application/pdf",
    }));
    const removeDocument = retain(async () => {
      await processedDocument(uploaded.id);
      await request("estimate draft deletion", () => client.documents.remove(uploaded.id));
    });
    expect((await processedDocument(uploaded.id)).status).toBe("metadata_ready");
    const estimate = await request("envelope estimate", () => client.envelopes.estimateCost(accountId, {
      name: runId,
      signers: [{ id: signer.id, verification_method: "Email", notification_methods: ["Email"] }],
      documents: [{ id: uploaded.id, method: "virtual", signer_ids: [signer.id] }],
    }), context);
    expect(typeof estimate.has_sufficient_resources).toBe("boolean");
    expect(estimate.documents).toBe(1);
    expect(Array.isArray(estimate.breakdown)).toBe(true);
    expect((await request("draft after estimate", () => client.documents.get(uploaded.id))).status).toBe("metadata_ready");
    expect((await request("envelopes after estimate", () => client.envelopes.list(accountId, { search: runId }))).data.length).toBe(0);
    await removeDocument();
    await removeSigner();
  });

  liveTest("creates, updates and removes only its own embedded signing origin", async (context) => {
    const before = await request("embed origin list", () => client.embedded.listOrigins(accountId), context);
    if (before.length >= 10) context.skip("The workspace already uses all ten embed origins");
    const origin = `https://${runId}.example.test`;
    const created = await request("embed origin creation", () => client.embedded.createOrigin(accountId, { origin }), context);
    const remove = retain(() => request("embed origin deletion", () => client.embedded.deleteOrigin(accountId, created.id)));
    expect(created.origin === origin).toBe(true);
    const updatedOrigin = `https://${runId}-updated.example.test`;
    const updated = await request("embed origin update", () => client.embedded.updateOrigin(accountId, created.id, { origin: updatedOrigin }));
    expect(updated.id === created.id && updated.origin === updatedOrigin).toBe(true);
    const listed = await request("embed origin after update", () => client.embedded.listOrigins(accountId));
    expect(listed.some((item) => item.id === created.id && item.origin === updatedOrigin)).toBe(true);
    await remove();
    const after = await request("embed origins after deletion", () => client.embedded.listOrigins(accountId));
    expect(after.some((item) => item.id === created.id)).toBe(false);
    expect(before.every((original) => after.some((item) => item.id === original.id && item.origin === original.origin))).toBe(true);
  });

  liveTest("rotates signing secrets with overlap on its own inactive webhook endpoint", async (context) => {
    const account = await request("disposable workspace creation", () => client.accounts.create({ name: runId }), context);
    const removeAccount = retain(() => request("disposable workspace deletion", () => client.accounts.remove(account.id)));
    const endpoint = await request("inactive webhook creation", () => client.webhooks.createEndpoint(account.id, {
      url: `https://example.test/${runId}`, email: "sdk-webhook@example.test",
      events: ["document_ready"], is_active: false, signing_enabled: true,
    }), context);
    const removeEndpoint = retain(() => request("inactive webhook deletion", () => client.webhooks.deleteEndpoint(account.id, endpoint.id)));
    const original = await request("webhook secret", () => client.webhooks.getEndpointSecret(account.id, endpoint.id));
    const rotated = await request("webhook overlap rotation", () => client.webhooks.rotateEndpointSecret(account.id, endpoint.id, { keep_previous: true }));
    expect(typeof rotated.secret === "string" && rotated.secret !== original.secret).toBe(true);
    const expiresAt = Date.parse(rotated.previous_secret_expires_at ?? "");
    expect(Number.isFinite(expiresAt) && expiresAt > Date.now() && expiresAt < Date.now() + 25 * 3_600_000).toBe(true);
    const stored = await request("rotated webhook secret", () => client.webhooks.getEndpointSecret(account.id, endpoint.id));
    expect(stored.secret === rotated.secret).toBe(true);
    expect((await request("inactive endpoint detail", () => client.webhooks.getEndpoint(account.id, endpoint.id))).is_active).toBe(false);
    const dispatches = await request("inactive endpoint dispatches", () => client.webhooks.listDispatches(account.id, { endpoint_id: endpoint.id }));
    expect(dispatches.data.length).toBe(0);
    await removeEndpoint();
    await removeAccount();
  });

  liveTest("rejects unknown embed and certified-copy tokens without sending notifications", async () => {
    const token = (crypto.randomUUID() + crypto.randomUUID()).replaceAll("-", "");
    expect(await statusOf(() => anonymous.embedded.exchangeSession(token))).toBe(410);
    expect(await statusOf(() => anonymous.signature.downloadCertifiedCopy(token))).toBe(302);
    expect(await statusOf(() => anonymous.signature.resendCertifiedCopy(token))).toBe(404);
  });

  const probe = "sdkcontractprobe";
  for (const [name, call] of [
    ["accounts.getUsage", () => anonymous.accounts.getUsage(probe)],
    ["accounts.getNotificationPolicy", () => anonymous.accounts.getNotificationPolicy(probe)],
    ["accounts.updateNotificationPolicy", () => anonymous.accounts.updateNotificationPolicy(probe, { owners_receive_all: false })],
    ["users.getPushPreferences", () => anonymous.users.getPushPreferences()],
    ["users.updatePushPreferences", () => anonymous.users.updatePushPreferences({ SignerViewed: true })],
    ["envelopes.list", () => anonymous.envelopes.list(probe)],
    ["envelopes.create", () => anonymous.envelopes.create(probe, { name: "SDK probe", signers: [], documents: [] })],
    ["envelopes.estimateCost", () => anonymous.envelopes.estimateCost(probe, { name: "SDK probe", signers: [], documents: [] })],
    ["envelopes.get", () => anonymous.envelopes.get(probe, probe)],
    ["envelopes.update", () => anonymous.envelopes.update(probe, probe, { name: "SDK probe" })],
    ["envelopes.remove", () => anonymous.envelopes.remove(probe, probe)],
    ["envelopes.activities", () => anonymous.envelopes.activities(probe, probe)],
    ["envelopes.download", () => anonymous.envelopes.download(probe, probe, "original")],
    ["envelopes.cancel", () => anonymous.envelopes.cancel(probe, probe)],
    ["envelopes.resendToSigner", () => anonymous.envelopes.resendToSigner(probe, probe, probe)],
    ["envelopes.addDocument", () => anonymous.envelopes.addDocument(probe, probe, { id: probe, signer_ids: [] })],
    ["envelopes.removeDocument", () => anonymous.envelopes.removeDocument(probe, probe, probe)],
    ["embedded.listOrigins", () => anonymous.embedded.listOrigins(probe)],
    ["embedded.createOrigin", () => anonymous.embedded.createOrigin(probe, { origin: "https://example.test" })],
    ["embedded.updateOrigin", () => anonymous.embedded.updateOrigin(probe, probe, { origin: "https://example.test" })],
    ["embedded.deleteOrigin", () => anonymous.embedded.deleteOrigin(probe, probe)],
    ["embedded.createSession", () => anonymous.embedded.createSession(probe, probe, probe)],
    ["webhooks.testEndpoint", () => anonymous.webhooks.testEndpoint(probe, probe)],
    ["signature.sendCertifiedCopy", () => anonymous.signature.sendCertifiedCopy(probe)],
  ] as const) {
    liveTest(`challenges unauthenticated ${name}`, async () => {
      expect(await statusOf(call)).toBe(401);
    });
  }
});
