import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifyWebhookSignature,
  isValidWebhookSignature,
} from "../../src/adapters/webhook.js";
import { WebhookSignatureError } from "../../src/client/errors.js";

function sign(secret: string, payload: string, encoding: "hex" | "base64" = "hex"): string {
  return createHmac("sha256", secret).update(payload).digest(encoding);
}

describe("verifyWebhookSignature", () => {
  const secret = "shh";
  const body = `{"event":"signed","document_id":"d-1"}`;

  it("accepts a valid signature", () => {
    const sig = sign(secret, body);
    expect(verifyWebhookSignature({ secret, body, signature: sig })).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = sign(secret, body);
    expect(() =>
      verifyWebhookSignature({ secret, body: body + "tampered", signature: sig }),
    ).toThrow(WebhookSignatureError);
  });

  it("rejects with the wrong secret", () => {
    const sig = sign(secret, body);
    expect(() =>
      verifyWebhookSignature({ secret: "other", body, signature: sig }),
    ).toThrow(WebhookSignatureError);
  });

  it("supports the Slack/Stripe-style `${timestamp}.${body}` payload", () => {
    const ts = Math.floor(Date.now() / 1000);
    const payload = `${ts}.${body}`;
    const sig = sign(secret, payload);
    expect(
      verifyWebhookSignature({ secret, body, signature: `v0=${sig}`, timestamp: ts }),
    ).toBe(true);
  });

  it("rejects timestamps outside the tolerance window", () => {
    const ts = Math.floor(Date.now() / 1000) - 3600; // an hour ago
    const sig = sign(secret, `${ts}.${body}`);
    expect(() =>
      verifyWebhookSignature({ secret, body, signature: sig, timestamp: ts, toleranceSeconds: 300 }),
    ).toThrow(/tolerance/);
  });

  it("accepts a base64-encoded signature when configured", () => {
    const sig = sign(secret, body, "base64");
    expect(
      verifyWebhookSignature({ secret, body, signature: sig, encoding: "base64" }),
    ).toBe(true);
  });

  it("isValidWebhookSignature returns boolean instead of throwing", () => {
    const sig = sign(secret, body);
    expect(isValidWebhookSignature({ secret, body, signature: sig })).toBe(true);
    expect(
      isValidWebhookSignature({ secret, body: "altered", signature: sig }),
    ).toBe(false);
  });

  it("supports an empty Uint8Array body", () => {
    const empty = new Uint8Array(0);
    const sig = sign(secret, "");
    expect(verifyWebhookSignature({ secret, body: empty, signature: sig })).toBe(true);
  });

  it("fails closed when the secret is missing or empty", () => {
    const sig = sign("", body);
    expect(() => verifyWebhookSignature({ secret: "", body, signature: sig })).toThrow(
      WebhookSignatureError,
    );
    expect(isValidWebhookSignature({ secret: "", body, signature: sig })).toBe(false);
  });

  it("verifies a binary body with a timestamp without corrupting non-UTF-8 bytes", () => {
    const ts = Math.floor(Date.now() / 1000);
    const raw = new Uint8Array([0xff, 0x00, 0xfe, 0x80]); // invalid UTF-8
    const prefix = new TextEncoder().encode(`${ts}.`);
    const payload = new Uint8Array(prefix.length + raw.length);
    payload.set(prefix, 0);
    payload.set(raw, prefix.length);
    const sig = createHmac("sha256", secret).update(payload).digest("hex");
    expect(verifyWebhookSignature({ secret, body: raw, signature: sig, timestamp: ts })).toBe(true);
  });
});
