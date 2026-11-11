/** Embedded signing origins and single-use sessions (`client.embedded`). */
import { ConfigurationError } from "./errors.js";
import type { HttpClient } from "./http.js";
import { anonymousTransport } from "./internal.js";
import type {
  EmbedOrigin,
  EmbedOriginInput,
  EmbedSession,
  EmbedSessionExchange,
  ExchangeEmbedSessionInput,
} from "./embedded-types.js";

const paths = {
  origins: (accountId: string) => `/accounts/${encodeURIComponent(accountId)}/embed-origins`,
  origin: (accountId: string, originId: string) =>
    `/accounts/${encodeURIComponent(accountId)}/embed-origins/${encodeURIComponent(originId)}`,
  sessions: (documentId: string, assignmentId: string, signerId: string) =>
    `/documents/${encodeURIComponent(documentId)}/assignments/${encodeURIComponent(assignmentId)}/signers/${encodeURIComponent(signerId)}/embed-sessions`,
  exchange: (token: string) => `/embed/sessions/${encodeURIComponent(token)}/exchange`,
};

/**
 * Configure iframe origins and mint signing sessions for embedded signers.
 * Origin management requires the embedded-signing plan feature and is not
 * available to OAuth applications. Session URLs and exchanged access codes
 * are bearer credentials: keep them out of logs, storage and LLM tools.
 */
export class EmbeddedResource {
  private readonly anonymous: HttpClient;

  constructor(private readonly http: HttpClient) {
    this.anonymous = anonymousTransport(http);
  }

  /**
   * `GET /accounts/{accountId}/embed-origins` — no body; returns
   * {@link EmbedOrigin}[] oldest first. A missing plan feature returns `403`
   * (`PlanRestricted`). Origin management does not accept OAuth applications.
   */
  async listOrigins(accountId: string): Promise<EmbedOrigin[]> {
    return this.http.get(paths.origins(accountId));
  }

  /**
   * `POST /accounts/{accountId}/embed-origins` — `{ origin }`; returns the
   * created {@link EmbedOrigin}. Use an exact HTTPS origin, or HTTP only for
   * localhost/127.0.0.1. The API strips a trailing slash/default port and
   * lowercases the host. Invalid, duplicate or more than ten origins return
   * `400`; a missing plan feature returns `403` (`PlanRestricted`).
   */
  async createOrigin(accountId: string, input: EmbedOriginInput): Promise<EmbedOrigin> {
    const { origin } = input;
    return this.http.post(paths.origins(accountId), { origin });
  }

  /**
   * `PUT /accounts/{accountId}/embed-origins/{originId}` — `{ origin }`;
   * returns the updated {@link EmbedOrigin}, preserving its ID. The same
   * origin rules as {@link createOrigin} apply. Unknown IDs return `404`.
   */
  async updateOrigin(accountId: string, originId: string, input: EmbedOriginInput): Promise<EmbedOrigin> {
    const { origin } = input;
    return this.http.put(paths.origin(accountId, originId), { origin });
  }

  /**
   * `DELETE /accounts/{accountId}/embed-origins/{originId}` — no body;
   * removes the origin. Removing the last origin prevents new sessions with
   * `409` (`embed_origins_missing`). Unknown IDs return `404`.
   */
  async deleteOrigin(accountId: string, originId: string): Promise<void> {
    await this.http.delete(paths.origin(accountId, originId));
  }

  /**
   * `POST /documents/{documentId}/assignments/{assignmentId}/signers/{signerId}/embed-sessions`
   * — no body; returns {@link EmbedSession} for a signer created with
   * `embedded: true`. Load the URL unchanged in an iframe on an allowed
   * origin within five minutes. Opening it spends the token; mint a new
   * session each time. The signer access code is not returned here.
   *
   * `400`: embed_not_enabled_for_signer. `409`: already_signed,
   * document_not_ready, document_unavailable or embed_origins_missing.
   * `403`: PlanRestricted. `429`: over 30 sessions for one signer per hour.
   * This mutation is never automatically retried.
   */
  async createSession(documentId: string, assignmentId: string, signerId: string): Promise<EmbedSession> {
    return this.http.post(paths.sessions(documentId, assignmentId, signerId));
  }

  /**
   * `POST /embed/sessions/{token}/exchange` — optional `{ parent_origin }`;
   * returns {@link EmbedSessionExchange}. Intended for Assinafy's embed page;
   * integrations normally load the URL from {@link createSession} instead.
   * The token is the sole credential; no workspace key or bearer is sent.
   * It is consumed even on a `409`; invalid, expired or used tokens return
   * `410` (`embed_session_invalid`). Never retry or log this operation.
   */
  async exchangeSession(token: string, input?: ExchangeEmbedSessionInput): Promise<EmbedSessionExchange> {
    if (typeof token !== "string" || token.trim() === "") {
      throw new ConfigurationError("A non-empty embed session token is required");
    }
    return this.anonymous.post(paths.exchange(token), input === undefined ? undefined : {
      parent_origin: input.parent_origin,
    });
  }
}
