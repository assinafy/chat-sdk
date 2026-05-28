/**
 * Live integration tests against https://sandbox.assinafy.com.br/v1.
 *
 * These tests exercise every client resource against the real sandbox API.
 * They skip themselves automatically when ASSINAFY_API_KEY /
 * ASSINAFY_ACCOUNT_ID are not present, so `npm test` works in CI without
 * credentials.
 */
import { afterAll, describe, it, expect } from "vitest";
import { AssinafyClient } from "../../src/client/index.js";
import { loadEnv, makeMinimalPdf } from "../setup.js";

const env = loadEnv();
const describeLive = env ? describe : describe.skip;

describeLive("Assinafy API — live sandbox", () => {
  const client = new AssinafyClient({
    apiKey: env!.apiKey,
    baseUrl: env!.baseUrl,
    accountId: env!.accountId,
  });
  const publicClient = new AssinafyClient({
    baseUrl: env!.baseUrl,
  });

  // Track resources we create so we can clean up at the end.
  const cleanup: Array<() => Promise<void>> = [];
  afterAll(async () => {
    for (const task of cleanup.reverse()) await task();
  });

  it("documents.statuses() returns the canonical status list", async () => {
    const statuses = await client.documents.statuses();
    expect(statuses.length).toBeGreaterThan(0);
    const codes = statuses.map((s) => s.code);
    expect(codes).toContain("uploaded");
    expect(codes).toContain("certificated");
    expect(codes).toContain("pending_signature");
  });

  it("signers.list() paginates", async () => {
    const page = await client.signers.list(env!.accountId, { perPage: 1 });
    expect(page.pagination.perPage).toBe(1);
    expect(page.pagination.totalCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(page.data)).toBe(true);
  });

  it("signers.create / get / update / remove round-trip", async () => {
    const created = await client.signers.create(env!.accountId, {
      full_name: "Chat SDK Test",
      email: `chat-sdk-${Date.now()}@example.com`,
    });
    cleanup.push(async () => {
      try {
        await client.signers.remove(env!.accountId, created.id);
      } catch {
        /* ignore cleanup races */
      }
    });
    expect(created.id).toBeTruthy();
    expect(created.full_name).toBe("Chat SDK Test");

    const fetched = await client.signers.get(env!.accountId, created.id);
    expect(fetched.id).toBe(created.id);

    const updated = await client.signers.update(env!.accountId, created.id, {
      full_name: "Chat SDK Test (renamed)",
    });
    expect(updated.full_name).toBe("Chat SDK Test (renamed)");

    await client.signers.remove(env!.accountId, created.id);
    await expect(client.signers.get(env!.accountId, created.id)).rejects.toThrow();
  });

  it("documents.upload then list/get/download/public/activities/remove", async () => {
    const filename = `chat-sdk-test-${Date.now()}.pdf`;
    const doc = await client.documents.upload(env!.accountId, {
      filename,
      body: makeMinimalPdf(),
      contentType: "application/pdf",
    });
    cleanup.push(async () => {
      try {
        await client.documents.remove(doc.id);
      } catch {
        /* ignore cleanup races */
      }
    });
    expect(doc.id).toBeTruthy();
    expect(doc.name).toContain("chat-sdk-test-");

    const fetched = await client.documents.get(doc.id);
    expect(fetched.id).toBe(doc.id);

    const listed = await client.documents.list(env!.accountId, { search: filename, perPage: 10 });
    expect(listed.data.some((d) => d.id === doc.id)).toBe(true);

    const original = await client.documents.download(doc.id, "original");
    expect(original.ok).toBe(true);

    const publicInfo = await client.documents.publicGet(doc.id);
    expect(publicInfo.id).toBe(doc.id);

    const ready = await waitForDocument(doc.id, (d) => (d.pages?.length ?? 0) > 0);
    const firstPage = ready.pages![0]!;
    const page = await client.documents.downloadPage(doc.id, firstPage.id);
    expect(page.ok).toBe(true);

    const thumbnail = await client.documents.thumbnail(doc.id);
    expect(thumbnail.ok).toBe(true);

    const acts = await client.documents.activities(doc.id);
    expect(Array.isArray(acts)).toBe(true);
  }, 60_000);

  it("fields.create / list / get / validate / update / remove round-trip", async () => {
    const name = `Chat SDK Field ${Date.now()}`;
    const field = await client.fields.create(env!.accountId, {
      type: "text",
      name,
      regex: "/^[A-Z0-9-]+$/",
    });
    cleanup.push(async () => {
      try {
        await client.fields.remove(env!.accountId, field.id);
      } catch {
        /* ignore cleanup races */
      }
    });
    expect(field.id).toBeTruthy();

    const listed = await client.fields.list(env!.accountId, { search: name, include_inactive: true });
    expect(listed.data.some((f) => f.id === field.id)).toBe(true);

    const fetched = await client.fields.get(env!.accountId, field.id);
    expect(fetched.id).toBe(field.id);

    const valid = await client.fields.validate(env!.accountId, field.id, "ABC-123");
    expect(valid.success).toBe(true);

    const invalid = await client.fields.validateMultiple(env!.accountId, [
      { field_id: field.id, value: "not valid spaces" },
    ]);
    expect(invalid[0]?.success).toBe(false);

    const updated = await client.fields.update(env!.accountId, field.id, { name: `${name} Updated` });
    expect(updated.name).toContain("Updated");

    const types = await client.fields.listTypes();
    expect(types.some((type) => type.type === "text")).toBe(true);

    await client.fields.remove(env!.accountId, field.id);
  });

  it("webhooks read-only endpoints return expected shapes", async () => {
    const eventTypes = await client.webhooks.listEventTypes();
    expect(eventTypes.length).toBeGreaterThan(0);
    expect(eventTypes.some((event) => event.id === "document_ready")).toBe(true);

    const subscription = await client.webhooks.getSubscription(env!.accountId);
    expect(subscription === null || Array.isArray(subscription.events)).toBe(true);

    const dispatches = await client.webhooks.listDispatches(env!.accountId, { perPage: 1 });
    expect(Array.isArray(dispatches.data)).toBe(true);
    expect(dispatches.pagination.totalCount).toBeGreaterThanOrEqual(0);
  });

  it("tags.create / list / document attach / detach / remove", async () => {
    const doc = await client.documents.upload(env!.accountId, {
      filename: `cs-tag-${Date.now()}.pdf`,
      body: makeMinimalPdf("tag test"),
    });
    cleanup.push(async () => {
      try {
        await client.documents.remove(doc.id);
      } catch {
        /* ignore */
      }
    });

    const tagName = `cs-test-${Date.now()}`;
    const tag = await client.tags.create(env!.accountId, { name: tagName, color: "#888888" });
    cleanup.push(async () => {
      try {
        await client.tags.remove(env!.accountId, tag.id, { force: true });
      } catch {
        /* ignore */
      }
    });
    expect(tag.id).toBeTruthy();

    const listed = await client.tags.list(env!.accountId, tagName);
    expect(listed.data.some((t) => t.id === tag.id)).toBe(true);

    const setTags = await client.tags.setForDocument(env!.accountId, doc.id, [tagName]);
    expect(setTags.some((t) => t.name === tagName)).toBe(true);

    const docTags = await client.tags.listForDocument(env!.accountId, doc.id);
    expect(docTags.some((t) => t.id === tag.id)).toBe(true);

    const appended = await client.tags.addToDocument(env!.accountId, doc.id, [`${tagName}-extra`]);
    expect(appended.some((t) => t.name === `${tagName}-extra`)).toBe(true);

    await client.tags.removeFromDocument(env!.accountId, doc.id, tag.id);
    const afterDetach = await client.tags.listForDocument(env!.accountId, doc.id);
    expect(afterDetach.some((t) => t.id === tag.id)).toBe(false);

    await client.tags.remove(env!.accountId, tag.id, { force: true });
  });

  it("templates.list() and estimateCost() are wired when templates exist", async () => {
    const templates = await client.templates.list(env!.accountId, { perPage: 1 });
    expect(Array.isArray(templates.data)).toBe(true);
    if (templates.data.length === 0) return;

    const template = templates.data[0]!;
    const role = template.roles?.[0];
    if (!role) return;

    const estimate = await client.templates.estimateCost(env!.accountId, template.id, {
      signers: [{ role_id: role.id }],
    });
    expect(typeof estimate.has_sufficient_resources).toBe("boolean");
  });

  it("documents.iterate() walks pages", async () => {
    let count = 0;
    for await (const _ of client.documents.iterate(env!.accountId, { perPage: 2 })) {
      count++;
      if (count >= 3) break;
    }
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("full happy path: upload + create signers + create assignment + notification actions", async () => {
    // Lookup-or-create makes the test idempotent across runs.
    const a = await ensureSigner(env!.primaryEmail, "Bill M");
    const b = await ensureSigner(env!.secondaryEmail, "Bill M");

    const doc = await client.documents.upload(env!.accountId, {
      filename: `cs-assign-${Date.now()}.pdf`,
      body: makeMinimalPdf(),
    });
    cleanup.push(async () => {
      try {
        await client.documents.remove(doc.id);
      } catch {
        /* ignore */
      }
    });

    const estimate = await client.assignments.estimateCost(doc.id, {
      method: "virtual",
      signers: [{ id: a.id }, { id: b.id }],
    });
    expect(typeof estimate.has_sufficient_resources).toBe("boolean");

    const assignment = await client.assignments.create(doc.id, {
      method: "virtual",
      signers: [{ id: a.id }, { id: b.id }],
      message: "chat-sdk live integration test",
    });
    expect(assignment.id).toBeTruthy();
    expect(assignment.summary.signer_count).toBe(2);
    expect(assignment.signing_urls?.length).toBe(2);

    const resendCost = await client.assignments.estimateResendCost(doc.id, assignment.id, a.id);
    expect(typeof resendCost.total).toBe("number");

    const resend = await client.assignments.resendToSigner(doc.id, assignment.id, a.id);
    expect(resend).toBeTruthy();

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const reset = await client.assignments.resetExpiration(doc.id, assignment.id, expiresAt);
    expect(reset.id).toBe(assignment.id);

    const whatsappNotifications = await client.assignments.whatsappNotifications(doc.id, assignment.id);
    expect(Array.isArray(whatsappNotifications)).toBe(true);

    const token = await client.documents.sendPublicToken(doc.id, {
      recipient: env!.primaryEmail,
      channel: "email",
    });
    expect(token.recipient).toBe(env!.primaryEmail);

    const accessCode = extractAccessCode(assignment.signing_urls?.[0]?.url);
    if (accessCode) {
      const self = await publicClient.signature.self(accessCode);
      expect(self.id).toBe(a.id);

      await publicClient.signers.confirmDataForDocument(doc.id, accessCode, {
        email: env!.primaryEmail,
        has_accepted_terms: true,
      });

      const signerDocument = await publicClient.signature.signContext(accessCode, { hasAcceptedTerms: true });
      expect(signerDocument.id).toBe(doc.id);

      const current = await publicClient.signature.currentDocument(a.id, accessCode);
      expect(current.id).toBe(doc.id);

      const signerDocs = await publicClient.signature.listDocuments(a.id, accessCode, { perPage: 1 });
      expect(Array.isArray(signerDocs.data)).toBe(true);

      const signerDownload = await publicClient.signature.downloadDocument(a.id, doc.id, "original", accessCode);
      expect(signerDownload.ok).toBe(true);
    }
  }, 60_000);

  /** Find an existing signer by email or create one. */
  async function ensureSigner(email: string, fullName: string) {
    const page = await client.signers.list(env!.accountId, { search: email, perPage: 50 });
    const existing = page.data.find((s) => s.email === email);
    if (existing) return existing;
    return client.signers.create(env!.accountId, { full_name: fullName, email });
  }

  async function waitForDocument(
    documentId: string,
    predicate: (document: Awaited<ReturnType<typeof client.documents.get>>) => boolean,
    timeoutMs = 30_000,
  ) {
    const startedAt = Date.now();
    let last = await client.documents.get(documentId);
    while (!predicate(last) && Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      last = await client.documents.get(documentId);
    }
    expect(predicate(last)).toBe(true);
    return last;
  }

  function extractAccessCode(url: string | undefined): string | undefined {
    if (!url) return undefined;
    try {
      const parsed = new URL(url);
      const queryKeys = ["signer-access-code", "signer_access_code", "access_code", "code", "token"];
      for (const key of queryKeys) {
        const value = parsed.searchParams.get(key);
        if (value) return value;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
});
