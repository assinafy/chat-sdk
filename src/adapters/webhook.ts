/**
 * Webhook signature verification utilities.
 *
 * Platform adapters (Resend, Slack, Stripe-style services) typically deliver
 * inbound events via HTTPS webhook with an HMAC-SHA256 signature in a header.
 * The canonical verification flow is:
 *
 * 1. Extract the signature header.
 * 2. Reject with 401 if it's missing or malformed.
 * 3. Compute HMAC-SHA256 over the raw request body using the shared secret.
 * 4. `timingSafeEqual` the computed digest against the supplied signature.
 * 5. Optionally check a `t=` timestamp against a clock-skew tolerance to
 *    prevent replay attacks.
 *
 * This module ships those steps as small, dependency-free primitives so each
 * adapter only writes the header-parsing glue specific to its platform.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookSignatureError } from "../client/errors.js";

/** Options for {@link verifyWebhookSignature}. */
export interface VerifyWebhookSignatureOptions {
  /** Shared secret configured for the webhook. */
  secret: string;
  /** The raw request body (string or bytes). The signature MUST cover the raw bytes. */
  body: string | Uint8Array;
  /** The signature value from the request header (hex or base64). */
  signature: string;
  /**
   * Optional Unix timestamp (seconds) supplied by the sender, e.g. Slack's
   * `X-Slack-Request-Timestamp`. When present, requests older than
   * {@link toleranceSeconds} are rejected.
   */
  timestamp?: number | string;
  /** Replay-protection window in seconds. Defaults to 300 (5 min). */
  toleranceSeconds?: number;
  /** Hash algorithm. Defaults to `sha256`. */
  algorithm?: "sha256" | "sha1" | "sha512";
  /** Encoding of the supplied `signature`. Defaults to `hex`. */
  encoding?: "hex" | "base64";
  /**
   * When the sender signs `${timestamp}.${body}` (Slack/Stripe style),
   * provide a custom signing payload builder. Defaults to signing just the
   * body when no timestamp is provided, or `${timestamp}.${body}` when one is.
   */
  buildPayload?: (timestamp: number | string | undefined, body: string | Uint8Array) => string | Uint8Array;
}

/**
 * Verify a webhook signature. Returns `true` if valid; throws
 * {@link WebhookSignatureError} otherwise. The "boolean OR throw" shape lets
 * callers either `if (verify(...))` or `try { verify(...) } catch {}`.
 */
export function verifyWebhookSignature(options: VerifyWebhookSignatureOptions): true {
  const algorithm = options.algorithm ?? "sha256";
  const encoding = options.encoding ?? "hex";
  const tolerance = options.toleranceSeconds ?? 300;

  // An empty secret makes every signature derivable by an attacker, so a
  // misconfigured secret must fail closed rather than "verify" forged requests.
  if (!options.secret) {
    throw new WebhookSignatureError("Webhook secret is missing or empty");
  }

  if (options.timestamp !== undefined) {
    const ts = Number(options.timestamp);
    if (!Number.isFinite(ts)) {
      throw new WebhookSignatureError("Webhook timestamp is not a valid number");
    }
    const ageSeconds = Math.abs(Date.now() / 1000 - ts);
    if (ageSeconds > tolerance) {
      throw new WebhookSignatureError(
        `Webhook timestamp is outside the ${tolerance}s tolerance window (drift=${Math.round(ageSeconds)}s)`,
      );
    }
  }

  const payload = options.buildPayload
    ? options.buildPayload(options.timestamp, options.body)
    : defaultPayload(options.timestamp, options.body);

  const expected = createHmac(algorithm, options.secret).update(toBytes(payload)).digest();
  const provided = decodeSignature(options.signature, encoding);

  if (expected.length !== provided.length) {
    throw new WebhookSignatureError("Webhook signature length mismatch");
  }
  if (!timingSafeEqual(expected, provided)) {
    throw new WebhookSignatureError("Webhook signature does not match");
  }
  return true;
}

/**
 * `verifyWebhookSignature` variant that returns a boolean instead of throwing,
 * for callers that want explicit branching without a try/catch.
 */
export function isValidWebhookSignature(options: VerifyWebhookSignatureOptions): boolean {
  try {
    return verifyWebhookSignature(options);
  } catch {
    return false;
  }
}

function defaultPayload(
  timestamp: number | string | undefined,
  body: string | Uint8Array,
): string | Uint8Array {
  if (timestamp === undefined) return body;
  // Slack/Stripe style: `${timestamp}.${body}`.
  if (typeof body === "string") return `${timestamp}.${body}`;
  // Binary body: prepend `${timestamp}.` as bytes so the raw payload the sender
  // signed is preserved exactly (a UTF-8 decode/re-encode round-trip would
  // corrupt non-UTF-8 bytes and break verification).
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const out = new Uint8Array(prefix.length + body.length);
  out.set(prefix, 0);
  out.set(body, prefix.length);
  return out;
}

function toBytes(payload: string | Uint8Array): Uint8Array {
  return typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
}

function decodeSignature(signature: string, encoding: "hex" | "base64"): Buffer {
  // Strip an optional algorithm prefix (Slack `v0=…`, GitHub `sha256=…`).
  // We only treat `=` as a delimiter when it's preceded by a short
  // alphanumeric token AND followed by non-padding content. That avoids
  // chewing into legitimate base64 `=` padding at the end of a signature.
  const eq = signature.indexOf("=");
  if (eq > 0 && eq <= 10) {
    const prefix = signature.slice(0, eq);
    const rest = signature.slice(eq + 1);
    if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(prefix) && /[^=]/.test(rest)) {
      return Buffer.from(rest, encoding);
    }
  }
  return Buffer.from(signature, encoding);
}
