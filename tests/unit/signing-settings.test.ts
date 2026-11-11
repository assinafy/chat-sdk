import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { AssinafyClient, ConfigurationError, type SigningDocument } from "../../src/client/index.js";

function fixture(status = 200, data: unknown = { available: true, sent_to: "s***@example.test", resends_left: null }) {
  const calls: Array<{ url: URL; init: RequestInit; body: unknown }> = [];
  const fetch = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: new URL(String(url)), init, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify({ status, message: "result", data }), {
      status, headers: { "content-type": "application/json" },
    });
  });
  const client = new AssinafyClient({ apiKey: "workspace-secret", fetch, maxRetries: 2, retryBaseDelayMs: 0 });
  return { client, calls, data, fetch };
}

describe("workspace and user settings", () => {
  it("reads features, usage and independent notification settings", async () => {
    const { client, calls, data } = fixture();
    expect(await client.accounts.get("a/b", { expand: "signing_features" })).toEqual(data);
    await client.accounts.getUsage("a/b");
    await client.accounts.getNotificationPolicy("a/b");
    await client.users.getPushPreferences();
    expect(calls.map(({ url }) => url.pathname + url.search)).toEqual([
      "/v1/accounts/a%2Fb?expand=signing_features", "/v1/accounts/a%2Fb/usage",
      "/v1/accounts/a%2Fb/notification-policy", "/v1/users/self/push-preferences",
    ]);
    expect(calls.every(({ init }) => new Headers(init.headers).get("x-api-key") === "workspace-secret")).toBe(true);
  });

  it("preserves false switches and sends only declared settings", async () => {
    const { client, calls } = fixture();
    const policy = { owners_receive_all: false, events: { SignerViewed: false }, editable: true };
    const push = { SignerViewed: false, SignerSigned: true, ignored: true };
    await client.accounts.updateNotificationPolicy("a", policy);
    await client.users.updatePushPreferences(push);
    expect(calls.map(({ body }) => body)).toEqual([
      { owners_receive_all: false, events: { SignerViewed: false } },
      { SignerViewed: false, SignerSigned: true },
    ]);
    expect(calls.map(({ init }) => init.method)).toEqual(["PUT", "PUT"]);
  });
});

describe("signer branding and certified copies", () => {
  it.each([false, true])("preserves the signer context when the access code is closed=%s", async (closed) => {
    const compact = {
      id: "document1",
      name: "Agreement.pdf",
      status: "certificated",
      current_signer: {
        id: "signer1", verification_method: "Email", notification_methods: null, completed: true,
      },
      is_signer_access_closed: true,
      certified_copy: { available: true, notification_method: "Email", resends_left: null },
      envelope: { id: "envelope1", name: "Agreement" },
    } satisfies SigningDocument;
    const open = {
      ...compact,
      status: "pending_signature",
      account_id: "account1",
      artifacts: { original: "https://example.test/agreement.pdf" },
      is_closed: false,
      created_at: "2026-11-11T12:00:00Z",
      current_signer: {
        ...compact.current_signer, full_name: "Example Signer", email: "signer@example.test",
        has_accepted_terms: true, completed: false,
      },
      is_signer_access_closed: false,
      certified_copy: { available: false, notification_method: "Email", resends_left: null },
      assignment: { id: "assignment1", method: "virtual", items: [] },
    } satisfies SigningDocument;
    const data = closed ? compact : open;
    const { client } = fixture(200, data);
    expectTypeOf<Awaited<ReturnType<typeof client.signature.currentDocument>>>().toEqualTypeOf<SigningDocument>();
    expectTypeOf<Awaited<ReturnType<typeof client.signature.signContext>>>().toEqualTypeOf<SigningDocument>();
    expectTypeOf<SigningDocument["artifacts"]>().toEqualTypeOf<import("../../src/client/types.js").DocumentArtifacts | undefined>();

    for (const result of [
      await client.signature.signContext("example-code", { expand: "envelope" }),
      await client.signature.currentDocument("signer1", "example-code", { expand: "envelope" }),
    ]) {
      expect(result).toEqual(data);
      if (closed) {
        expect(result).not.toHaveProperty("assignment");
        expect(result).not.toHaveProperty("artifacts");
        expect(result.current_signer).not.toHaveProperty("email");
      } else {
        expect(result.assignment?.items).toEqual([]);
        expect(result.assignment).not.toHaveProperty("summary");
        expect(result.assignment).not.toHaveProperty("signers");
        expect(result.assignment).not.toHaveProperty("copy_receivers");
        expect(result.assignment).not.toHaveProperty("signing_urls");
      }
    }
  });

  it("isolates signer/public credentials and preserves closed-code responses", async () => {
    const { client, calls, data } = fixture();
    await client.signature.getTheme("code&secret");
    expect(await client.signature.downloadLogo("code&secret")).toBeInstanceOf(Response);
    expect(await client.signature.sendCertifiedCopy("code&secret", { document_id: "d" })).toEqual(data);
    await client.signature.downloadCertifiedCopy("token/path");
    await client.signature.downloadCertifiedCopy("token/path", "pades");
    await client.signature.resendCertifiedCopy("token/path");
    expect(calls.map(({ url }) => url.pathname)).toEqual([
      "/v1/sign/theme", "/v1/sign/logo", "/v1/sign/certified-copy",
      "/v1/signers/downloads/token%2Fpath", "/v1/signers/downloads/token%2Fpath/pades",
      "/v1/signers/downloads/token%2Fpath/resend",
    ]);
    for (const [index, { url, init }] of calls.entries()) {
      expect(new Headers(init.headers).has("x-api-key")).toBe(false);
      expect(new Headers(init.headers).has("authorization")).toBe(false);
      expect(url.searchParams.get("signer-access-code")).toBe(index < 3 ? "code&secret" : null);
      expect(init.redirect).toBe("manual");
    }
    expect(calls[2]!.body).toEqual({ document_id: "d" });
    expect(calls[5]!.init.method).toBe("POST");
  });

  it("rejects blank signer codes and download tokens before fetch", async () => {
    const { client, fetch } = fixture();
    await expect(client.signature.getTheme(" ")).rejects.toBeInstanceOf(ConfigurationError);
    await expect(client.signature.downloadLogo("")).rejects.toBeInstanceOf(ConfigurationError);
    await expect(client.signature.sendCertifiedCopy("")).rejects.toBeInstanceOf(ConfigurationError);
    await expect(client.signature.downloadCertifiedCopy(" ")).rejects.toBeInstanceOf(ConfigurationError);
    await expect(client.signature.resendCertifiedCopy("")).rejects.toBeInstanceOf(ConfigurationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("selects envelope context and documents without losing filters", async () => {
    const { client, calls } = fixture();
    await client.signature.signContext("code", { expand: "envelope", document_id: "d", hasAcceptedTerms: false });
    await client.signature.currentDocument("s", "code", { expand: "envelope" });
    await client.signature.listDocuments("s", "code", { envelope_id: "e" });
    await client.signature.listDocumentsAsWorkspace("s", { envelope_id: "e" });
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({
      "signer-access-code": "code", expand: "envelope", document_id: "d", has_accepted_terms: "false",
    });
    expect(calls[1]!.url.searchParams.get("expand")).toBe("envelope");
    expect(calls.slice(2).every(({ url }) => url.searchParams.get("envelope_id") === "e")).toBe(true);
  });
});

it("preserves webhook rotation overlap and sends one manual test", async () => {
  const { client, calls } = fixture();
  await client.webhooks.rotateEndpointSecret("a/b", "e/f", { keep_previous: true });
  await client.webhooks.rotateEndpointSecret("a/b", "e/f", { keep_previous: false });
  await client.webhooks.testEndpoint("a/b", "e/f");
  expect(calls.map(({ body }) => body)).toEqual([{ keep_previous: true }, { keep_previous: false }, undefined]);
  expect(calls[2]!.url.pathname).toBe("/v1/accounts/a%2Fb/webhooks/endpoints/e%2Ff/test");
});

it("does not retry certified-copy delivery, settings or webhook mutations", async () => {
  const { client, calls } = fixture(503);
  for (const call of [
    () => client.signature.sendCertifiedCopy("code"),
    () => client.signature.resendCertifiedCopy("token"),
    () => client.users.updatePushPreferences({ SignerViewed: false }),
    () => client.accounts.updateNotificationPolicy("a", { owners_receive_all: false }),
    () => client.webhooks.testEndpoint("a", "e"),
    () => client.webhooks.rotateEndpointSecret("a", "e", { keep_previous: true }),
  ]) await expect(call()).rejects.toMatchObject({ status: 503 });
  expect(calls).toHaveLength(6);
});
