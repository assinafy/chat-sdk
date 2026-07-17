/**
 * Top-level Assinafy API client.
 *
 * ```ts
 * import { AssinafyClient } from "@assinafy/chat-sdk/client";
 *
 * const client = new AssinafyClient({
 *   apiKey: process.env.ASSINAFY_API_KEY!,
 *   accountId: process.env.ASSINAFY_ACCOUNT_ID!,
 * });
 *
 * const { data: docs } = await client.documents.list(client.accountId);
 * ```
 *
 * Every resource is exposed as a property of the client so applications can
 * destructure individual resources when convenient:
 *
 * ```ts
 * const { signers, documents, assignments } = client;
 * ```
 */

import { AccountsResource } from "./accounts.js";
import { AssignmentsResource } from "./assignments.js";
import { AuthResource } from "./auth.js";
import { DocumentsResource } from "./documents.js";
import { FieldsResource } from "./fields.js";
import { ConfigurationError } from "./errors.js";
import { HttpClient, type AuthStrategy, type HttpClientOptions } from "./http.js";
import { SignatureResource } from "./signature.js";
import { SignersResource } from "./signers.js";
import { TagsResource } from "./tags.js";
import { TemplatesResource } from "./templates.js";
import { WebhooksResource } from "./webhooks.js";

export * from "./errors.js";
export * from "./types.js";
export { HttpClient, withQuery } from "./http.js";
export type { AuthStrategy, HttpClientOptions, ResponseWithMeta } from "./http.js";
export { AccountsResource, type UploadAccountLogoInput } from "./accounts.js";
export { AuthResource } from "./auth.js";
export { SignersResource } from "./signers.js";
export { DocumentsResource } from "./documents.js";
export { FieldsResource } from "./fields.js";
export { TagsResource } from "./tags.js";
export { TemplatesResource, type ListTemplatesQuery } from "./templates.js";
export { AssignmentsResource } from "./assignments.js";
export { SignatureResource, type SignatureType } from "./signature.js";
export { WebhooksResource } from "./webhooks.js";

/** Configuration accepted by {@link AssinafyClient}. */
export interface AssinafyClientOptions extends Omit<HttpClientOptions, "auth" | "baseUrl"> {
  /**
   * Base URL including version. Defaults to `https://api.assinafy.com.br/v1`
   * (production). For sandbox use `https://sandbox.assinafy.com.br/v1`.
   */
  baseUrl?: string;
  /** Long-lived API key. Mutually exclusive with `accessToken`. */
  apiKey?: string;
  /** Bearer access token (e.g. obtained from `auth.login`). */
  accessToken?: string;
  /**
   * Default account id. Optional — every resource method takes an explicit
   * `accountId` argument, but setting this lets you read it back as
   * `client.accountId`.
   */
  accountId?: string;
}

/** Resolve an auth strategy from the client options. */
function resolveAuth(options: AssinafyClientOptions): AuthStrategy {
  if (options.apiKey && options.accessToken) {
    throw new ConfigurationError("AssinafyClient: pass either apiKey or accessToken, not both");
  }
  if (options.apiKey) return { kind: "apiKey", apiKey: options.apiKey };
  if (options.accessToken) return { kind: "bearer", token: options.accessToken };
  return { kind: "none" };
}

/** Default to the production base URL when none is provided. */
const DEFAULT_BASE_URL = "https://api.assinafy.com.br/v1";

/**
 * Strongly-typed Assinafy API client. Composes one resource module per
 * top-level domain object (signers, documents, …). Resources are stateless
 * — every method takes whichever ids it needs as explicit arguments.
 */
export class AssinafyClient {
  /** The underlying HTTP transport. Exposed for advanced use-cases. */
  readonly http: HttpClient;

  /** Optional default account id, mirrored from constructor options. */
  readonly accountId: string | undefined;

  readonly accounts: AccountsResource;
  readonly auth: AuthResource;
  readonly signers: SignersResource;
  readonly documents: DocumentsResource;
  readonly fields: FieldsResource;
  readonly tags: TagsResource;
  readonly templates: TemplatesResource;
  readonly assignments: AssignmentsResource;
  readonly signature: SignatureResource;
  readonly webhooks: WebhooksResource;

  constructor(options: AssinafyClientOptions = {}) {
    this.http = new HttpClient({
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      auth: resolveAuth(options),
      fetch: options.fetch,
      maxRetries: options.maxRetries,
      retryBaseDelayMs: options.retryBaseDelayMs,
      userAgent: options.userAgent,
      onRateLimit: options.onRateLimit,
    });
    this.accountId = options.accountId;
    this.accounts = new AccountsResource(this.http);
    this.auth = new AuthResource(this.http);
    this.signers = new SignersResource(this.http);
    this.documents = new DocumentsResource(this.http);
    this.fields = new FieldsResource(this.http);
    this.tags = new TagsResource(this.http);
    this.templates = new TemplatesResource(this.http);
    this.assignments = new AssignmentsResource(this.http);
    this.signature = new SignatureResource(this.http);
    this.webhooks = new WebhooksResource(this.http);
  }

  /**
   * Build an `AssinafyClient` from `process.env`. Reads:
   *  - `ASSINAFY_API_KEY` (or `ASSINAFY_ACCESS_TOKEN`)
   *  - `ASSINAFY_BASE_URL` (optional, defaults to production)
   *  - `ASSINAFY_ACCOUNT_ID` (optional)
   *
   * Returns an unauthenticated client if neither key nor token is set; this is
   * useful for login and public signer/document flows.
   */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): AssinafyClient {
    return new AssinafyClient({
      apiKey: env.ASSINAFY_API_KEY,
      accessToken: env.ASSINAFY_ACCESS_TOKEN,
      baseUrl: env.ASSINAFY_BASE_URL,
      accountId: env.ASSINAFY_ACCOUNT_ID,
    });
  }
}
