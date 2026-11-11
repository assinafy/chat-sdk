/** An exact origin allowed to host the workspace's signing iframe. */
export interface EmbedOrigin {
  id: string;
  origin: string;
  created_at: string;
}

/** Add or replace an allowed origin; the API normalizes its host and port. */
export interface EmbedOriginInput {
  /** HTTPS origin, or HTTP for localhost/127.0.0.1; no path or wildcard. */
  origin: string;
}

/** Single-use bearer URL. Do not log it or expose it to model tools. */
export interface EmbedSession {
  /** Open unchanged in the signing iframe within five minutes, once only. */
  url: string;
  expires_at: string;
}

/** Optional context sent by Assinafy's embed page during token exchange. */
export interface ExchangeEmbedSessionInput {
  parent_origin?: string;
}

/** Credentials returned to Assinafy's embed page, never to model tools. */
export interface EmbedSessionExchange {
  signer_access_code: string;
  signer_id: string;
  document_id: string;
  verification_method: string;
  embed_origins: string[];
}
