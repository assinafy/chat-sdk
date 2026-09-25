/**
 * OAuth 2.1 + OpenID Connect — acting inside *other people's* workspaces.
 *
 * Use this resource only when your product is connected by its users. To
 * automate your own workspace, keep using an API key and ignore everything
 * here; nothing else in the SDK changes.
 *
 * Two hosts are involved on purpose. The consent screen lives on the
 * authorization server (`https://auth.assinafy.com.br`) and only ever receives
 * a browser; the token, revocation and userinfo endpoints live on this API and
 * are only ever called server to server. Both are published by
 * {@link OAuthResource.getAuthorizationServerMetadata}, so nothing needs
 * hardcoding.
 *
 * Every function here runs on the Web Crypto and Fetch globals, so the
 * `@assinafy/chat-sdk/client` entry point stays usable on Node 24+, Bun, Deno
 * and browsers alike. Confidential clients still belong on a server: a
 * `client_secret` must never reach browser or mobile code.
 *
 * @see https://api.assinafy.com.br/v1/docs
 */

import { ConfigurationError, OAuthError } from "./errors.js";
import type { AuthStrategy, HttpClient } from "./http.js";
import type {
  OAuthAuthorizationCallback,
  OAuthAuthorizationRequest,
  OAuthAuthorizationServerMetadata,
  OAuthProtectedResourceMetadata,
  OAuthScope,
  OAuthTokenResponse,
  OAuthUserInfo,
} from "./types.js";

/** RFC 8615 path of this API's protected-resource metadata, at the host root. */
const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";

/** RFC 8414 path of the authorization server's own metadata. */
const AUTHORIZATION_SERVER_PATH = "/.well-known/oauth-authorization-server";

/** RFC 7636 code-verifier grammar: 43–128 unreserved characters. */
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

/** Assinafy's authorization server: the `iss` a callback must carry unless told otherwise. */
const DEFAULT_ISSUER = "https://auth.assinafy.com.br";

const paths = {
  token: () => "/oauth/token",
  revoke: () => "/oauth/revoke",
  userinfo: () => "/oauth/userinfo",
};

/** How an application authenticates itself at the token and revocation endpoints. */
export interface OAuthClientAuth {
  /** The application's `client_id` from Settings → OAuth applications. */
  clientId: string;
  /**
   * The application's `client_secret`. Confidential applications only — public
   * ones authenticate with PKCE and are never issued a secret. Never ship it
   * in browser, mobile, or repository code.
   */
  clientSecret?: string;
}

/** Options for {@link OAuthResource.createAuthorizationUrl}. */
export interface CreateAuthorizationUrlOptions {
  /** The application's `client_id`. */
  clientId: string;
  /**
   * One of the application's registered redirect URIs, matched character for
   * character — `…/callback` and `…/callback/` are different. Must be
   * `https://` and carry no fragment.
   */
  redirectUri: string;
  /**
   * Permissions to request. The user approves all of them or none, so ask for
   * the minimum. Add `offline_access` for a refresh token and `openid` for an
   * `id_token`.
   */
  scopes: OAuthScope[];
  /** Skip discovery by supplying the endpoint. Defaults to the discovered one. */
  authorizationEndpoint?: string;
  /** Issuer to discover from, and the value the callback's `iss` must equal. */
  issuer?: string;
  /**
   * RFC 8707 resource indicator. Defaults to the API origin; pass `null` to
   * omit it. It must match the value sent to the token endpoint.
   */
  resource?: string | null;
  /** Supply your own CSRF value. Must be unique per attempt. */
  state?: string;
  /** Supply your own RFC 7636 verifier (43–128 unreserved characters). */
  codeVerifier?: string;
  /** OIDC nonce echoed in the `id_token`. `true` generates one. */
  nonce?: string | true;
  /** Passed through to the authorization server, e.g. `consent`. */
  prompt?: string;
}

/** What {@link OAuthResource.readAuthorizationCallback} checks the callback against. */
export interface ExpectedAuthorizationRequest {
  /** The `state` minted for this attempt. */
  state: string;
  /** The issuer the callback's `iss` must equal. Defaults to `https://auth.assinafy.com.br`. */
  issuer?: string;
}

/** Query parameters of a redirect callback, in whatever shape your framework hands you. */
export type AuthorizationCallbackParams =
  | string
  | URL
  | URLSearchParams
  | Record<string, unknown>;

/**
 * The OAuth endpoints, reachable as `client.oauth`.
 *
 * The full round trip:
 *
 * 1. {@link createAuthorizationUrl} — mint PKCE + `state`, build the consent
 *    URL, store the returned request in the user's session.
 * 2. Redirect the browser there; the user picks **one** workspace and approves.
 * 3. {@link readAuthorizationCallback} — check `state` and `iss` on your
 *    redirect URI, and surface a declined consent as an {@link OAuthError}.
 * 4. {@link exchangeCode} — swap the 60-second code for tokens.
 * 5. Build a per-connection client with that token and read the one workspace
 *    it covers:
 *    ```ts
 *    const connected = new AssinafyClient({ accessToken: tokens.access_token });
 *    const [account] = await connected.accounts.list();
 *    ```
 * 6. {@link refreshToken} before the hour is up (requires `offline_access`),
 *    and {@link revokeToken} when the user disconnects.
 *
 * Two facts cause most integration bugs: a token works for exactly one
 * workspace — any other answers `403` — and refresh tokens rotate, so a
 * retired one must never be sent again. A connection stays alive as long as it
 * is refreshed at least once every 30 days.
 *
 * @example
 * ```ts
 * const client = new AssinafyClient();              // no credentials needed
 *
 * // Step 1 — before redirecting the user
 * const request = await client.oauth.createAuthorizationUrl({
 *   clientId: process.env.ASSINAFY_CLIENT_ID!,
 *   redirectUri: "https://myapp.com/oauth/callback",
 *   scopes: ["documents:read", "documents:write", "offline_access"],
 * });
 * session.oauth = request;
 * response.redirect(request.url);
 *
 * // Steps 3-4 — on https://myapp.com/oauth/callback
 * const { code } = client.oauth.readAuthorizationCallback(query, session.oauth);
 * const tokens = await client.oauth.exchangeCode({
 *   code,
 *   codeVerifier: session.oauth.codeVerifier,
 *   redirectUri: "https://myapp.com/oauth/callback",
 *   clientId: process.env.ASSINAFY_CLIENT_ID!,
 *   clientSecret: process.env.ASSINAFY_CLIENT_SECRET,
 * });
 * ```
 */
export class OAuthResource {
  /**
   * Transport that sends no credentials. The token and revocation endpoints
   * authenticate the application with `client_id`/`client_secret`; attaching
   * the integrator's own `X-Api-Key` would hand a workspace credential to a
   * route that has no use for it.
   */
  private readonly anonymous: HttpClient;

  constructor(private readonly http: HttpClient) {
    this.anonymous = http.fork({ auth: { kind: "none" } });
  }

  /**
   * Read this API's protected-resource metadata
   * (`GET /.well-known/oauth-protected-resource`).
   *
   * Served at the API host root — not under `/v1` — and bare, without the
   * `{ status, message, data }` envelope, as RFC 8615 requires. It names the
   * authorization server allowed to issue tokens for this API and the scopes
   * the API accepts.
   *
   * Request body: none. Authentication: none.
   *
   * @returns
   * ```json
   * {
   *   "resource": "https://api.assinafy.com.br",
   *   "authorization_servers": ["https://auth.assinafy.com.br"],
   *   "scopes_supported": [
   *     "documents:read", "documents:write", "templates:read",
   *     "templates:write", "account:read", "webhooks:write", "openid", "profile", "email"
   *   ],
   *   "bearer_methods_supported": ["header"]
   * }
   * ```
   * `offline_access` is deliberately absent: it asks the authorization server
   * for a refresh token rather than naming a permission this API enforces.
   */
  getProtectedResourceMetadata(): Promise<OAuthProtectedResourceMetadata> {
    return this.anonymous.get<OAuthProtectedResourceMetadata>(
      `${this.http.origin}${PROTECTED_RESOURCE_PATH}`,
    );
  }

  /**
   * Read the authorization server's metadata
   * (`GET {issuer}/.well-known/oauth-authorization-server`, RFC 8414).
   *
   * Every endpoint URL an OAuth client needs comes from here, so nothing has
   * to be hardcoded. The document is served by the authorization server, a
   * different host from this API, and is not part of this API's OpenAPI
   * document.
   *
   * @param issuer Issuer to read. Defaults to the first entry of
   *   {@link getProtectedResourceMetadata}, which costs one extra request.
   * @returns
   * ```json
   * {
   *   "issuer": "https://auth.assinafy.com.br",
   *   "authorization_endpoint": "https://auth.assinafy.com.br/oauth/authorize",
   *   "token_endpoint": "https://api.assinafy.com.br/v1/oauth/token",
   *   "revocation_endpoint": "https://api.assinafy.com.br/v1/oauth/revoke",
   *   "userinfo_endpoint": "https://api.assinafy.com.br/v1/oauth/userinfo",
   *   "jwks_uri": "https://auth.assinafy.com.br/.well-known/jwks.json",
   *   "scopes_supported": ["documents:read", "documents:write", "templates:read", "templates:write", "account:read", "webhooks:write", "openid", "profile", "email", "offline_access"],
   *   "response_types_supported": ["code"],
   *   "grant_types_supported": ["authorization_code", "refresh_token"],
   *   "code_challenge_methods_supported": ["S256"],
   *   "token_endpoint_auth_methods_supported": ["client_secret_post", "none"],
   *   "authorization_response_iss_parameter_supported": true
   * }
   * ```
   * @throws {ConfigurationError} If `issuer` is not an absolute `https://` URL,
   *   or the document's own `issuer` disagrees with where it was fetched from
   *   (RFC 8414 §3.3 — a mismatch means the document is not authoritative).
   */
  async getAuthorizationServerMetadata(
    issuer?: string,
  ): Promise<OAuthAuthorizationServerMetadata> {
    const base = requireHttpsUrl(issuer ?? (await this.defaultIssuer()), "issuer").replace(/\/+$/, "");
    const metadata = await this.anonymous
      .fork({ baseUrl: base })
      .get<OAuthAuthorizationServerMetadata>(AUTHORIZATION_SERVER_PATH);
    if (trimSlash(metadata?.issuer) !== trimSlash(base)) {
      throw new ConfigurationError(
        `Authorization-server metadata issuer "${metadata?.issuer ?? ""}" does not match "${base}"`,
      );
    }
    return metadata;
  }

  /**
   * Mint a PKCE pair and a `state`, then build the consent URL to send the
   * user's browser to (`GET {authorization_endpoint}`).
   *
   * Call this once per connection attempt and keep the whole returned object
   * in the user's session: reusing a verifier or a `state` across attempts
   * defeats both PKCE and CSRF protection. Navigate with a full page load — a
   * `fetch` cannot show a consent screen.
   *
   * PKCE is mandatory for confidential applications too, and Assinafy accepts
   * only the `S256` challenge method.
   *
   * @returns The request to store in the session, e.g.
   * ```json
   * {
   *   "url": "https://auth.assinafy.com.br/oauth/authorize?client_id=abc&redirect_uri=https%3A%2F%2Fmyapp.com%2Foauth%2Fcallback&response_type=code&scope=documents%3Aread+offline_access&state=Ic1n…&code_challenge=E9Me…&code_challenge_method=S256&resource=https%3A%2F%2Fapi.assinafy.com.br",
   *   "state": "Ic1n7eJgQ2mQ2g6o4rKnNw",
   *   "codeVerifier": "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
   *   "codeChallenge": "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
   *   "issuer": "https://auth.assinafy.com.br",
   *   "redirectUri": "https://myapp.com/oauth/callback",
   *   "scope": "documents:read offline_access"
   * }
   * ```
   * @throws {ConfigurationError} If an argument is missing or malformed.
   */
  async createAuthorizationUrl(
    options: CreateAuthorizationUrlOptions,
  ): Promise<OAuthAuthorizationRequest> {
    requireNonEmpty(options?.clientId, "clientId");
    const redirectUri = requireRedirectUri(options.redirectUri);
    const scope = joinScopes(options.scopes);

    let endpoint = options.authorizationEndpoint;
    let issuer = options.issuer;
    if (!endpoint || !issuer) {
      const metadata = await this.getAuthorizationServerMetadata(issuer);
      endpoint ??= metadata.authorization_endpoint;
      issuer ??= metadata.issuer;
    }
    requireHttpsUrl(endpoint, "authorizationEndpoint");
    requireHttpsUrl(issuer, "issuer");

    const codeVerifier = options.codeVerifier ?? createCodeVerifier();
    requireCodeVerifier(codeVerifier);
    const state = options.state ?? randomBase64Url(16);
    requireNonEmpty(state, "state");
    const codeChallenge = await codeChallengeFor(codeVerifier);
    const nonce = options.nonce === true ? randomBase64Url(16) : options.nonce;

    const url = new URL(endpoint);
    const query = url.searchParams;
    query.set("client_id", options.clientId);
    query.set("redirect_uri", redirectUri);
    query.set("response_type", "code");
    query.set("scope", scope);
    query.set("state", state);
    query.set("code_challenge", codeChallenge);
    query.set("code_challenge_method", "S256");
    const resource = this.resourceParam(options.resource);
    if (resource) query.set("resource", resource);
    if (nonce) query.set("nonce", nonce);
    if (options.prompt) query.set("prompt", options.prompt);

    return { url: url.href, state, codeVerifier, codeChallenge, issuer, redirectUri, scope, nonce };
  }

  /**
   * Validate a redirect callback and pull the authorization code out of it
   * (your own redirect URI — no request is made).
   *
   * Runs the two checks the flow depends on before anything else — before a
   * declined consent is even reported: `state` must equal what
   * {@link createAuthorizationUrl} minted, and `iss` must be present and equal
   * the issuer it recorded (`https://auth.assinafy.com.br` when none is given).
   * A callback that fails either is not yours. A declined or failed consent
   * arrives as `?error=…` and is raised rather than returned, so the happy path
   * stays a straight line.
   *
   * Accepts the query in whatever shape your framework hands you: a full
   * callback URL, a `URL`, a `URLSearchParams`, a bare `code=…&state=…` string,
   * or Express's `request.query` object.
   *
   * @returns
   * ```json
   * {
   *   "code": "def5020089a1…",
   *   "state": "Ic1n7eJgQ2mQ2g6o4rKnNw",
   *   "issuer": "https://auth.assinafy.com.br"
   * }
   * ```
   * @throws {OAuthError} With `error` set to the server's code — `access_denied`
   *   when the user declined, `invalid_scope`, `invalid_request`,
   *   `unsupported_response_type` or `invalid_target` — or to `invalid_request`
   *   when `state`, `iss` or `code` fails its check.
   */
  readAuthorizationCallback(
    params: AuthorizationCallbackParams,
    expected: ExpectedAuthorizationRequest,
  ): OAuthAuthorizationCallback {
    requireNonEmpty(expected?.state, "expected.state");
    const query = toSearchParams(params);

    // `state` and `iss` first, `?error=` returns included: a response that
    // fails either did not come from the attempt this session started.
    const state = query.get("state") ?? "";
    if (!constantTimeEquals(state, expected.state)) {
      throw callbackError("invalid_request", "The callback state does not match this session");
    }

    const issuer = query.get("iss") ?? "";
    if (!issuer || trimSlash(issuer) !== trimSlash(expected.issuer || DEFAULT_ISSUER)) {
      throw callbackError("invalid_request", "The callback issuer does not match this session");
    }

    const failure = query.get("error");
    if (failure) {
      throw callbackError(failure, query.get("error_description") ?? undefined);
    }

    const code = query.get("code") ?? "";
    if (!code) {
      throw callbackError("invalid_request", "The callback carries no authorization code");
    }
    return { code, state, issuer };
  }

  /**
   * Exchange an authorization code for tokens
   * (`POST /oauth/token`, `grant_type=authorization_code`).
   *
   * The code is single-use and expires 60 seconds after the redirect, so run
   * this as soon as the callback lands. `redirectUri` must repeat the value
   * sent to the authorization endpoint character for character.
   *
   * Request body — sent form-encoded (`application/x-www-form-urlencoded`) and
   * without any workspace credential; fields shown as JSON:
   * ```json
   * {
   *   "grant_type": "authorization_code",
   *   "code": "def5020089a1…",
   *   "redirect_uri": "https://myapp.com/oauth/callback",
   *   "code_verifier": "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
   *   "client_id": "01jd6m9x4k2p8v3r",
   *   "client_secret": "cs_live_9f2b…",
   *   "resource": "https://api.assinafy.com.br"
   * }
   * ```
   * Public applications send the same body without `client_secret`.
   *
   * @returns A flat token object — the OAuth endpoints never use the API's
   *   `{ status, message, data }` envelope:
   * ```json
   * {
   *   "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9…",
   *   "token_type": "Bearer",
   *   "expires_in": 3600,
   *   "scope": "documents:read documents:write",
   *   "refresh_token": "def50200f1e2…",
   *   "id_token": "eyJraWQiOiIy…"
   * }
   * ```
   * `refresh_token` appears only with `offline_access`, `id_token` only with
   * `openid`. Read `scope` rather than assuming you got what you asked for.
   * @throws {ConfigurationError} If an argument is missing or malformed.
   * @throws {OAuthError} `invalid_grant` when the code expired, was replayed,
   *   or the verifier or redirect URI disagree; `invalid_client` when client
   *   authentication fails; `invalid_target` on a `resource` mismatch.
   */
  async exchangeCode(
    options: OAuthClientAuth & {
      code: string;
      codeVerifier: string;
      redirectUri: string;
      resource?: string | null;
    },
  ): Promise<OAuthTokenResponse> {
    requireNonEmpty(options?.code, "code");
    requireCodeVerifier(options.codeVerifier);
    return this.requestToken({
      grant_type: "authorization_code",
      code: options.code,
      redirect_uri: requireRedirectUri(options.redirectUri),
      code_verifier: options.codeVerifier,
      ...clientAuth(options),
      resource: this.resourceParam(options.resource),
    });
  }

  /**
   * Renew an access token (`POST /oauth/token`, `grant_type=refresh_token`).
   *
   * Access tokens last one hour; refresh tokens exist only when
   * `offline_access` was requested and granted.
   *
   * **Refresh tokens rotate.** Every call returns a new one and retires the one
   * you sent, and a replayed refresh token cannot be told apart from a stolen
   * one — so the server ends the entire connection and the user has to
   * reconnect. Therefore: persist `refresh_token` from the response before
   * doing anything else with it, and never run two refreshes concurrently for
   * one connection. This method never retries the request itself.
   *
   * Send each refresh token at most once. A timeout, a dropped connection or a
   * `5xx` may arrive after the server already rotated the token, so treat it as
   * "it may have succeeded": re-read your stored token, and if it is still the
   * one you sent, never send it again — mark the connection unusable and ask
   * the user to reconnect. Only a newer token in your storage is safe to use.
   * The one failure that may be retried with the same token is one that
   * provably happened before sending: a {@link ConfigurationError}, a DNS
   * failure, a refused connection, or a TLS handshake error.
   *
   * A refresh token is valid for 30 days and every refresh returns a new one
   * with a fresh 30 days, so a connection only expires after 30 days without a
   * refresh.
   *
   * Request body, form-encoded:
   * ```json
   * {
   *   "grant_type": "refresh_token",
   *   "refresh_token": "def50200f1e2…",
   *   "client_id": "01jd6m9x4k2p8v3r",
   *   "client_secret": "cs_live_9f2b…",
   *   "resource": "https://api.assinafy.com.br"
   * }
   * ```
   *
   * @returns The same shape as {@link exchangeCode}, carrying a **new**
   *   `refresh_token` to persist immediately:
   * ```json
   * {
   *   "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9…",
   *   "token_type": "Bearer",
   *   "expires_in": 3600,
   *   "scope": "documents:read documents:write",
   *   "refresh_token": "def50200a7c4…"
   * }
   * ```
   * @throws {ConfigurationError} If an argument is missing or malformed.
   * @throws {OAuthError} `invalid_grant` when the refresh token was already
   *   used, expired, or its authorization no longer includes `offline_access`
   *   — including after the user approved the application again with
   *   different permissions — and when a `2xx` carries no new `refresh_token`
   *   (missing, empty, or the one sent). The connection is gone: ask the user
   *   to reconnect.
   */
  async refreshToken(
    options: OAuthClientAuth & { refreshToken: string; resource?: string | null },
  ): Promise<OAuthTokenResponse> {
    requireNonEmpty(options?.refreshToken, "refreshToken");
    const tokens = await this.requestToken({
      grant_type: "refresh_token",
      refresh_token: options.refreshToken,
      ...clientAuth(options),
      resource: this.resourceParam(options.resource),
    });
    // The token sent is already retired: without a new one there is nothing
    // to persist, and persisting the old one sets up a fatal replay.
    const next = tokens.refresh_token;
    if (typeof next !== "string" || !next.trim() || next === options.refreshToken) {
      throw callbackError(
        "invalid_grant",
        "The token endpoint returned no new refresh_token; the connection must be re-established",
      );
    }
    return tokens;
  }

  /**
   * Revoke an access or refresh token (`POST /oauth/revoke`).
   *
   * Call it when a user disconnects in your product rather than only dropping
   * your copy of the token. Revoking a refresh token ends the connection.
   *
   * Request body, form-encoded:
   * ```json
   * {
   *   "token": "def50200f1e2…",
   *   "token_type_hint": "refresh_token",
   *   "client_id": "01jd6m9x4k2p8v3r",
   *   "client_secret": "cs_live_9f2b…"
   * }
   * ```
   *
   * Every token outcome answers `200` — revoked, already revoked, unknown or
   * malformed alike — so the endpoint cannot be used to probe whether a token
   * exists, and this method resolves rather than returning a body. Only failed
   * client authentication is reported.
   *
   * @throws {ConfigurationError} If an argument is missing or malformed.
   * @throws {OAuthError} `invalid_client` when client authentication fails.
   */
  async revokeToken(
    options: OAuthClientAuth & {
      token: string;
      tokenTypeHint?: "access_token" | "refresh_token";
    },
  ): Promise<void> {
    requireNonEmpty(options?.token, "token");
    await this.anonymous.request<unknown>(
      paths.revoke(),
      formPost({ token: options.token, token_type_hint: options.tokenTypeHint, ...clientAuth(options) }),
    );
  }

  /**
   * Read the OpenID Connect claims of the user who approved the connection
   * (`GET /oauth/userinfo`).
   *
   * Requires the `openid` scope; `name` additionally requires `profile` and
   * `email` requires `email`. Like the token endpoint, the response is a flat
   * claims object rather than the API's usual envelope.
   *
   * @param accessToken Token to present. Defaults to the client's own
   *   credential, which is what you want when the client was built with
   *   `new AssinafyClient({ accessToken })`.
   * @returns
   * ```json
   * {
   *   "sub": "d6zqpbyog2v3xvxerwn8la94",
   *   "name": "Aline Costa",
   *   "email": "owner@example.test",
   *   "email_verified": true
   * }
   * ```
   * @throws {OAuthError} `invalid_token` when the token expired or was revoked,
   *   or `insufficient_scope` when `openid` was never granted — the missing
   *   permission is on {@link OAuthError.scope}.
   */
  getUserInfo(accessToken?: string): Promise<OAuthUserInfo> {
    const auth: AuthStrategy | undefined = accessToken
      ? { kind: "bearer", token: accessToken }
      : undefined;
    const http = auth ? this.http.fork({ auth }) : this.http;
    return http.get<OAuthUserInfo>(paths.userinfo());
  }

  /**
   * POST the token endpoint and reject a `2xx` that carries no access token.
   * Never retried: the transport retries safe methods only, and a replayed
   * code or refresh token is fatal.
   */
  private async requestToken(body: Record<string, string | undefined>): Promise<OAuthTokenResponse> {
    const { data: tokens } = await this.anonymous.request<OAuthTokenResponse>(paths.token(), formPost(body));
    if (typeof tokens?.access_token !== "string" || !tokens.access_token) {
      throw callbackError("invalid_grant", "The token endpoint returned no access_token");
    }
    return tokens;
  }

  /**
   * Resolve the optional RFC 8707 resource indicator.
   *
   * Defaults to the API origin, which is what this API publishes as its
   * `resource`. A loopback `http://` base URL — the shape mock servers use —
   * has no valid resource identifier, so the parameter is omitted rather than
   * rejected; an explicitly supplied value must still be `https`.
   */
  private resourceParam(resource: string | null | undefined): string | undefined {
    if (resource === null) return undefined;
    if (resource === undefined) {
      return this.http.origin.startsWith("https:") ? this.http.origin : undefined;
    }
    return requireHttpsUrl(resource, "resource");
  }

  /** Discover which authorization server may issue tokens for this API. */
  private async defaultIssuer(): Promise<string> {
    const metadata = await this.getProtectedResourceMetadata();
    const issuer = metadata?.authorization_servers?.[0];
    if (typeof issuer !== "string" || !issuer) {
      throw new ConfigurationError("Protected-resource metadata lists no authorization server");
    }
    return issuer;
  }
}

/** `client_secret_post` credentials, omitting the secret for public clients. */
function clientAuth(options: OAuthClientAuth): Record<string, string | undefined> {
  requireNonEmpty(options?.clientId, "clientId");
  if (options.clientSecret !== undefined) requireNonEmpty(options.clientSecret, "clientSecret");
  return { client_id: options.clientId, client_secret: options.clientSecret };
}

/**
 * An `application/x-www-form-urlencoded` POST, the encoding RFC 6749 and
 * RFC 7009 define for the token and revocation endpoints. Keys the caller left
 * undefined are dropped rather than sent empty.
 */
function formPost(body: Record<string, string | undefined>): RequestInit {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) if (value !== undefined) form.set(key, value);
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  };
}

/**
 * An {@link OAuthError} for a failure the SDK detected itself, rather than one
 * read off an HTTP response: a declined consent arriving on the redirect, a
 * `state` that does not match, or a token response with no token in it.
 */
function callbackError(error: string, errorDescription?: string): OAuthError {
  return new OAuthError({
    status: 400,
    body: { error, error_description: errorDescription },
    path: "/oauth/authorize",
    method: "GET",
    message: errorDescription ?? `OAuth authorization failed: ${error}`,
    error,
    errorDescription,
  });
}

/** RFC 7636 verifier: 32 random bytes rendered as 43 base64url characters. */
function createCodeVerifier(): string {
  return randomBase64Url(32);
}

/** Random base64url value, used for `state`, `nonce` and the PKCE verifier. */
function randomBase64Url(bytes: number): string {
  return base64Url(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

/** RFC 7636 `S256` challenge derived from a verifier. */
async function codeChallengeFor(codeVerifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier),
  );
  return base64Url(new Uint8Array(digest));
}

/** base64url without padding, using only globals available in every runtime. */
function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function requireNonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConfigurationError(`${label} must be a non-empty string`);
  }
}

function requireCodeVerifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || !CODE_VERIFIER_PATTERN.test(value)) {
    throw new ConfigurationError(
      "codeVerifier must be 43-128 characters from A-Z a-z 0-9 - . _ ~",
    );
  }
}

/** Require an absolute `https://` URL; returns it unchanged for chaining. */
function requireHttpsUrl(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConfigurationError(`${label} must be an absolute https URL`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError(`${label} must be an absolute https URL`);
  }
  if (url.protocol !== "https:") {
    throw new ConfigurationError(`${label} must be an absolute https URL`);
  }
  return value;
}

function requireRedirectUri(value: unknown): string {
  const uri = requireHttpsUrl(value, "redirectUri");
  if (uri.includes("#")) {
    throw new ConfigurationError("redirectUri must not contain a fragment");
  }
  return uri;
}

/** Validate the requested permissions and join them into a `scope` string. */
function joinScopes(scopes: unknown): string {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new ConfigurationError("scopes must be a non-empty array of scope strings");
  }
  for (const scope of scopes) {
    if (typeof scope !== "string" || scope.trim().length === 0 || /\s/.test(scope)) {
      throw new ConfigurationError("each scope must be a non-empty string without whitespace");
    }
  }
  return [...new Set(scopes as string[])].join(" ");
}

/** Compare issuer identifiers ignoring a trailing slash. */
function trimSlash(value: unknown): string {
  return typeof value === "string" ? value.replace(/\/+$/, "") : "";
}

/**
 * Compare two `state` values without leaking their contents through timing.
 * Length is compared first and separately — the length of a CSRF token is not
 * the secret part.
 */
function constantTimeEquals(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

/** Accept every practical shape a callback's query parameters arrive in. */
function toSearchParams(params: AuthorizationCallbackParams): URLSearchParams {
  if (params instanceof URLSearchParams) return params;
  if (params instanceof URL) return params.searchParams;
  if (typeof params === "string") {
    // A full callback URL, or the bare `code=…&state=…` query behind it.
    return params.includes("://")
      ? new URL(params).searchParams
      : new URLSearchParams(params.replace(/^\?/, ""));
  }
  if (typeof params !== "object" || params === null) {
    throw new ConfigurationError("callback parameters must be a URL, query string, or object");
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    // Express repeats a duplicated query key as an array; the first value is
    // the one the browser sent first, and OAuth defines no repeats.
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") search.set(key, first);
  }
  return search;
}
