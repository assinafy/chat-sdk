/**
 * Live integration tests against https://sandbox.assinafy.com.br/v1.
 *
 * These tests exercise every client resource against the real sandbox API.
 * They skip themselves automatically when ASSINAFY_API_KEY /
 * ASSINAFY_ACCOUNT_ID are not present, so `npm test` works in CI without
 * credentials.
 */
import { afterAll, describe, it, expect } from "vitest";
import { ApiError, AssinafyClient } from "../../src/client/index.js";
import { loadEnv, makeMinimalPdf } from "../setup.js";

const env = loadEnv();
const describeLive = env ? describe : describe.skip;
const itWithNotifications = env?.notificationsEnabled ? it : it.skip;

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
    const errors: unknown[] = [];
    for (const task of cleanup.reverse()) {
      try {
        await task();
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, "Sandbox cleanup failed");
  });

  it("documents.statuses() returns the canonical status list", async () => {
    const statuses = await client.documents.statuses();
    expect(statuses.length).toBeGreaterThan(0);
    const codes = statuses.map((s) => s.code);
    expect(codes).toContain("uploaded");
    expect(codes).toContain("certificated");
    expect(codes).toContain("pending_signature");

    const invalid = await publicClient.documents.verify("0".repeat(64));
    expect(invalid.is_valid).toBe(false);
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
    cleanup.push(() => client.signers.remove(env!.accountId, created.id));
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
    cleanup.push(() => client.documents.remove(doc.id));
    expect(doc.id).toBeTruthy();
    expect(doc.name).toContain("chat-sdk-test-");

    const fetched = await client.documents.get(doc.id);
    expect(fetched.id).toBe(doc.id);

    const estimate = await client.assignments.estimateCost(doc.id, {
      method: "virtual",
      signers: [{}],
    });
    expect(typeof estimate.has_sufficient_resources).toBe("boolean");

    const listed = await client.documents.list(env!.accountId, { search: filename, perPage: 10 });
    expect(listed.data.some((d) => d.id === doc.id)).toBe(true);

    const original = await client.documents.download(doc.id, "original");
    expect(original.ok).toBe(true);

    const publicInfo = await client.documents.publicGet(doc.id);
    expect(publicInfo.id).toBe(doc.id);

    // Page images and the `original` artifact are rendered asynchronously by
    // the metadata pipeline; they are only guaranteed once the document leaves
    // `metadata_processing`. Wait for a terminal metadata state (plus a page)
    // before exercising the binary-download endpoints.
    const ready = await waitForDocument(
      doc.id,
      (d) => (d.pages?.length ?? 0) > 0 && d.status !== "uploaded" && d.status !== "metadata_processing",
    );
    const firstPage = ready.pages![0]!;
    const page = await client.documents.downloadPage(doc.id, firstPage.id);
    expect(page.ok).toBe(true);

    const thumbnail = await client.documents.thumbnail(doc.id);
    expect(thumbnail.ok).toBe(true);

    const acts = await client.documents.activities(doc.id);
    expect(Array.isArray(acts)).toBe(true);

    await client.documents.remove(doc.id);
    await expect(client.documents.get(doc.id)).rejects.toMatchObject({ status: 404 });
  }, 60_000);

  it("fields.create / list / get / validate / update / remove round-trip", async () => {
    const name = `Chat SDK Field ${Date.now()}`;
    const field = await client.fields.create(env!.accountId, {
      type: "text",
      name,
      regex: "/^[A-Z0-9-]+$/",
    });
    cleanup.push(() => client.fields.remove(env!.accountId, field.id));
    expect(field.id).toBeTruthy();

    const listed = await client.fields.list(env!.accountId, { include_inactive: true });
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
    cleanup.push(() => client.documents.remove(doc.id));

    const tagName = `cs-test-${Date.now()}`;
    const tag = await client.tags.create(env!.accountId, { name: tagName, color: "#888888" });
    cleanup.push(async () => {
      await client.tags.remove(env!.accountId, tag.id, { force: true });
    });
    expect(tag.id).toBeTruthy();
    const updatedTag = await client.tags.update(env!.accountId, tag.id, { color: "#999999" });
    expect(updatedTag.color).toBe("999999");

    const extraTag = await client.tags.create(env!.accountId, {
      name: `${tagName}-extra`,
      color: "#777777",
    });
    cleanup.push(async () => {
      await client.tags.remove(env!.accountId, extraTag.id, { force: true });
    });

    const listed = await client.tags.list(env!.accountId, tagName);
    expect(listed.data.some((t) => t.id === tag.id)).toBe(true);

    // The sandbox accepts tag names as well as IDs.
    const setTags = await client.tags.setForDocument(env!.accountId, doc.id, [tagName]);
    expect(setTags.some((t) => t.name === tagName)).toBe(true);

    const docTags = await client.tags.listForDocument(env!.accountId, doc.id);
    expect(docTags.some((t) => t.id === tag.id)).toBe(true);

    const appended = await client.tags.addToDocument(env!.accountId, doc.id, [extraTag.name]);
    expect(appended.some((t) => t.id === extraTag.id)).toBe(true);

    await client.tags.removeFromDocument(env!.accountId, doc.id, tag.id);
    const afterDetach = await client.tags.listForDocument(env!.accountId, doc.id);
    expect(afterDetach.some((t) => t.id === tag.id)).toBe(false);

    await client.tags.remove(env!.accountId, tag.id, { force: true });
    await client.tags.remove(env!.accountId, extraTag.id, { force: true });
    await waitForDocument(
      doc.id,
      (candidate) => !["uploading", "uploaded", "metadata_processing"].includes(candidate.status),
    );
    await client.documents.remove(doc.id);
    await expect(client.documents.get(doc.id)).rejects.toMatchObject({ status: 404 });
  }, 60_000);

  it("templates.list / detail / estimate use the sandbox template fixture", async () => {
    const templates = await client.templates.list(env!.accountId, { perPage: 1 });
    expect(Array.isArray(templates.data)).toBe(true);
    expect(templates.data.length).toBeGreaterThan(0);

    const template = templates.data[0]!;

    const detail = await client.templates.get(env!.accountId, template.id);
    expect(detail.id).toBe(template.id);

    expect(detail.roles?.length ?? 0).toBeGreaterThan(0);
    const role = detail.roles![0]!;

    const estimate = await client.templates.estimateCost(env!.accountId, template.id, {
      signers: [{ role_id: role.id }],
    });
    expect(typeof estimate.has_sufficient_resources).toBe("boolean");
  });

  itWithNotifications("templates.instantiate creates and cleans up a document", async () => {
    const templates = await client.templates.list(env!.accountId, { perPage: 1 });
    const template = templates.data[0]!;
    const detail = await client.templates.get(env!.accountId, template.id);
    const role = detail.roles![0]!;

    const signer = await ensureSigner(env!.primaryEmail, "Bill M");
    const document = await client.templates.instantiate(env!.accountId, template.id, {
      name: `cs-template-${Date.now()}.pdf`,
      signers: [{ role_id: role.id, id: signer.id }],
    });
    cleanup.push(async () => {
      await waitForDocument(
        document.id,
        (candidate) => !["uploading", "uploaded", "metadata_processing"].includes(candidate.status),
      );
      await client.documents.remove(document.id);
    });
    expect(document.template_id).toBe(template.id);
    await waitForDocument(
      document.id,
      (candidate) => !["uploading", "uploaded", "metadata_processing"].includes(candidate.status),
    );
    await client.documents.remove(document.id);
    await expect(client.documents.get(document.id)).rejects.toMatchObject({ status: 404 });
  }, 60_000);

  it("documents.iterate() yields a disposable document", async () => {
    const filename = `cs-iterate-${Date.now()}.pdf`;
    const document = await client.documents.upload(env!.accountId, {
      filename,
      body: makeMinimalPdf("iterator test"),
    });
    cleanup.push(async () => {
      await waitForDocument(
        document.id,
        (candidate) => !["uploading", "uploaded", "metadata_processing"].includes(candidate.status),
      );
      await client.documents.remove(document.id);
    });
    await waitForDocument(
      document.id,
      (candidate) => !["uploading", "uploaded", "metadata_processing"].includes(candidate.status),
    );

    let found = false;
    for await (const candidate of client.documents.iterate(env!.accountId, {
      search: filename,
      perPage: 1,
    })) {
      if (candidate.id === document.id) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);

    await client.documents.remove(document.id);
    await expect(client.documents.get(document.id)).rejects.toMatchObject({ status: 404 });
  }, 60_000);

  it("accounts.list / get / getTheme return the configured account", async () => {
    const accounts = await client.accounts.list();
    expect(Array.isArray(accounts)).toBe(true);
    expect(accounts.some((a) => a.id === env!.accountId)).toBe(true);

    const account = await client.accounts.get(env!.accountId);
    expect(account.id).toBe(env!.accountId);
    expect(typeof account.name).toBe("string");

    const theme = await client.accounts.getTheme(env!.accountId);
    expect(typeof theme.account_name).toBe("string");
  });

  it("account CRUD and logo operations round-trip on a disposable account", async () => {
    const account = await client.accounts.create({
      name: `Chat SDK Test ${Date.now()}`,
    });
    cleanup.push(() => client.accounts.remove(account.id, { force: true }));

    const updated = await client.accounts.update(account.id, { name: `${account.name} Updated` });
    expect(updated.name).toContain("Updated");
    expect((await client.accounts.get(account.id)).id).toBe(account.id);
    expect(typeof (await client.accounts.getTheme(account.id)).account_name).toBe("string");

    const png = Uint8Array.from(
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n1cAAAAASUVORK5CYII=", "base64"),
    );
    await client.accounts.uploadLogo(account.id, {
      filename: "pixel.png",
      body: png,
      contentType: "image/png",
    });
    expect((await client.accounts.downloadLogo(account.id)).ok).toBe(true);
    await client.accounts.deleteLogo(account.id);

    const initialSubscription = await client.webhooks.getSubscription(account.id);
    expect(
      initialSubscription === null ||
        (Array.isArray(initialSubscription.events) && typeof initialSubscription.is_active === "boolean"),
    ).toBe(true);
    const subscription = await client.webhooks.updateSubscription(account.id, {
      events: ["document_ready"],
      is_active: true,
      url: "https://example.com/assinafy-sandbox-test",
      email: "sdk-webhook@example.test",
    });
    expect(subscription.is_active).toBe(true);
    expect((await client.webhooks.inactivate(account.id)).is_active).toBe(false);

    await expectAvailableOrSandbox404(() => client.accounts.getStats(account.id), (rows) => {
      expect(Array.isArray(rows)).toBe(true);
    });

    await client.accounts.remove(account.id, { force: true });
    await expect(client.accounts.get(account.id)).rejects.toMatchObject({ status: 404 });
  });

  it("users/self and the latest statistics/preferences contract are exercised", async () => {
    const user = await client.users.getCurrent();
    expect(user.id).toBeTruthy();
    expect(user.email).toContain("@");

    const apiKey = await client.auth.getApiKey();
    expect(apiKey === null || apiKey.api_key === null || typeof apiKey.api_key === "string").toBe(true);

    await expectAvailableOrSandbox404(() => client.users.getStats(), (rows) => {
      expect(Array.isArray(rows)).toBe(true);
    });
    await expectAvailableOrSandbox404(() => client.accounts.getStats(env!.accountId), (rows) => {
      expect(Array.isArray(rows)).toBe(true);
    });

    await expectAvailableOrSandbox404(
      async () => {
        const preferences = await client.users.getNotificationPreferences();
        return client.users.updateNotificationPreferences({
          DocumentCompleted: preferences.DocumentCompleted,
        });
      },
      (preferences) => expect(typeof preferences.DocumentCompleted).toBe("boolean"),
    );
  });

  it("assignments.list either returns the documented page or the known sandbox context error", async () => {
    try {
      const assignments = await client.assignments.list({ perPage: 1 });
      expect(Array.isArray(assignments.data)).toBe(true);
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
    }
  });

  it("documents.search returns a compact page and rename updates the name", async () => {
    const search = await client.documents.search(env!.accountId, { perPage: 5 });
    expect(Array.isArray(search.data)).toBe(true);
    expect(search.pagination.perPage).toBe(5);

    // Rename requires a fresh document that has no assignment yet.
    const doc = await client.documents.upload(env!.accountId, {
      filename: `cs-rename-${Date.now()}.pdf`,
      body: makeMinimalPdf("rename test"),
    });
    cleanup.push(() => client.documents.remove(doc.id));
    const ready = await waitForDocument(doc.id, (d) => d.status === "metadata_ready");
    expect(ready.status).toBe("metadata_ready");

    const renamed = await client.documents.rename(doc.id, `renamed-${Date.now()}.pdf`);
    expect(renamed.name).toContain("renamed-");
  }, 60_000);

  itWithNotifications("full happy path: upload + create signers + create assignment + notification actions", async () => {
    // Lookup-or-create makes the test idempotent across runs.
    const a = await ensureSigner(env!.primaryEmail, "Bill M");
    const b = await ensureSigner(env!.secondaryEmail, "Bill M");

    const doc = await client.documents.upload(env!.accountId, {
      filename: `cs-assign-${Date.now()}.pdf`,
      body: makeMinimalPdf(),
    });
    cleanup.push(() => client.documents.remove(doc.id));

    const estimate = await client.assignments.estimateCost(doc.id, {
      method: "virtual",
      signers: [{}, {}],
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
    expect(token === null || token === undefined || typeof token === "object").toBe(true);

    const accessCode = extractAccessCode(assignment.signing_urls?.[0]?.url);
    if (!accessCode) {
      const signingUrl = new URL(assignment.signing_urls![0]!.url);
      expect(signingUrl.searchParams.get("email")).toBe(env!.primaryEmail);
      await client.documents.remove(doc.id);
      await expect(client.documents.get(doc.id)).rejects.toMatchObject({ status: 404 });
      return;
    }

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

    const searchedDocs = await publicClient.signature.searchDocuments(a.id, accessCode, doc.name);
    expect(Array.isArray(searchedDocs.data)).toBe(true);

    const signerDownload = await publicClient.signature.downloadDocument(a.id, doc.id, "original");
    expect(signerDownload.ok).toBe(true);

    await publicClient.signature.decline(doc.id, assignment.id, accessCode, "Automated sandbox cleanup");
    await waitForDocument(doc.id, (document) => document.status === "rejected_by_signer");
    await client.documents.remove(doc.id);
    await expect(client.documents.get(doc.id)).rejects.toMatchObject({ status: 404 });
  }, 60_000);

  /** Find an existing signer by email or create one. */
  async function ensureSigner(email: string, fullName: string) {
    const page = await client.signers.list(env!.accountId, { search: email, perPage: 50 });
    const existing = page.data.find((s) => s.email === email);
    if (existing) return existing;
    const created = await client.signers.create(env!.accountId, { full_name: fullName, email });
    cleanup.push(() => client.signers.remove(env!.accountId, created.id));
    return created;
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

  async function expectAvailableOrSandbox404<T>(
    request: () => Promise<T>,
    assertion: (value: T) => void,
  ): Promise<void> {
    try {
      assertion(await request());
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(404);
    }
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
