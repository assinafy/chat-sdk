/**
 * examples/oauth-connect.ts
 *
 * The whole OAuth round trip in one file: consent, callback, token exchange,
 * an authenticated call, refresh, and revocation. Use it when your product is
 * connected by *other people* to *their own* Assinafy workspaces. To automate
 * your own workspace, use an API key and ignore this example.
 *
 * It runs on `node:http` alone — no web framework — so the shape of the flow
 * stays visible. A real application replaces the in-memory `pending` map with
 * the user's session and stores the tokens per connection.
 *
 * The redirect URI must be registered on the application, must be `https://`,
 * and must match character for character. `http://localhost` is not accepted,
 * so point an https tunnel at this server and register the tunnel's URL:
 *
 *   ASSINAFY_CLIENT_ID=... ASSINAFY_CLIENT_SECRET=... \
 *   ASSINAFY_REDIRECT_URI=https://your-tunnel.example/oauth/callback \
 *     npx tsx examples/oauth-connect.ts
 *
 * Then open http://localhost:8787/ and follow the link.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  AssinafyClient,
  ApiError,
  ConfigurationError,
  OAuthError,
  type OAuthAuthorizationRequest,
  type OAuthTokenResponse,
} from "../src/index.js";

const PORT = Number(process.env.PORT ?? 8787);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const clientId = required("ASSINAFY_CLIENT_ID");
const redirectUri = required("ASSINAFY_REDIRECT_URI");
// Confidential applications only. Omit it for a public application, which
// authenticates with PKCE alone and is never issued a secret.
const clientSecret = process.env.ASSINAFY_CLIENT_SECRET;

/** An unauthenticated client is all the OAuth endpoints need. */
const client = new AssinafyClient({ baseUrl: process.env.ASSINAFY_BASE_URL });

/**
 * One entry per connection attempt, keyed by `state`. A real application keeps
 * this in the user's session — never in a shared process-wide map.
 */
const pending = new Map<string, OAuthAuthorizationRequest>();

/**
 * The live connection. A real application stores one row per connected
 * workspace: the tokens, the `accountId` they cover, and when they expire.
 *
 * `blocked` stops every further refresh: `"unusable"` once a refresh failed
 * after its token may have reached the server, which may already have retired
 * it, and `"disconnecting"` from the moment a disconnect starts.
 */
let connection:
  | { tokens: OAuthTokenResponse; accountId?: string; blocked?: "unusable" | "disconnecting" }
  | undefined;

function send(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}

/** Step 1 — mint PKCE + state and send the browser to the consent screen. */
async function start(response: ServerResponse): Promise<void> {
  const request = await client.oauth.createAuthorizationUrl({
    clientId,
    redirectUri,
    // Ask for the minimum your product needs: the user approves all of it or
    // none. `offline_access` is what buys a refresh token.
    scopes: ["documents:read", "documents:write", "offline_access"],
  });
  pending.set(request.state, request);
  response.writeHead(302, { location: request.url });
  response.end();
}

/** Steps 3-5 — validate the callback, exchange the code, find the workspace. */
async function callback(url: URL, response: ServerResponse): Promise<void> {
  // Look the attempt up by the state the browser came back with, then let the
  // SDK check it: an unknown state is already a failed check.
  const expected = pending.get(url.searchParams.get("state") ?? "");
  if (!expected) {
    send(response, 400, "<p>Unknown or expired connection attempt. Start again.</p>");
    return;
  }
  pending.delete(expected.state);

  // Verifies `state` and `iss`, and turns a declined consent into an
  // OAuthError, before the code is touched.
  const { code } = client.oauth.readAuthorizationCallback(url, expected);

  const tokens = await client.oauth.exchangeCode({
    code,
    codeVerifier: expected.codeVerifier,
    redirectUri,
    clientId,
    clientSecret,
  });

  // The token covers exactly one workspace. Ask which, and store its id
  // alongside the tokens — every other workspace answers 403.
  const connected = new AssinafyClient({ accessToken: tokens.access_token });
  const [account] = await connected.accounts.list();
  connection = { tokens, accountId: account?.id };

  send(
    response,
    200,
    `<p>Connected to workspace <code>${account?.id ?? "unknown"}</code>.</p>
     <p>Granted: <code>${tokens.scope ?? ""}</code></p>
     <p><a href="/documents">List documents</a> · <a href="/refresh">Refresh</a> ·
        <a href="/disconnect">Disconnect</a></p>`,
  );
}

/** Use the connection. Every call is scoped to the one workspace it covers. */
async function listDocuments(response: ServerResponse): Promise<void> {
  if (!connection?.accountId) {
    send(response, 400, "<p>Not connected.</p>");
    return;
  }
  const connected = new AssinafyClient({ accessToken: connection.tokens.access_token });
  const page = await connected.documents.list(connection.accountId, { perPage: 10 });
  const rows = page.data.map((document) => `<li>${document.name} — ${document.status}</li>`);
  send(response, 200, `<ul>${rows.join("") || "<li>No documents yet.</li>"}</ul>`);
}

/**
 * The refresh in flight. Concurrent requests share it, so the same refresh
 * token is never sent twice. This only covers one process: an application
 * running several replicas needs a per-connection lock in shared storage.
 */
let refreshing: Promise<OAuthTokenResponse> | undefined;

/**
 * Whether a refresh failed before its request left this process: rejected
 * arguments, a failed DNS lookup, a refused connection. Only then may the same
 * refresh token be sent again. A timeout, a dropped connection, a 5xx or an
 * error answer may all come after the server rotated the token.
 */
function failedBeforeSending(error: unknown): boolean {
  if (error instanceof ConfigurationError) return true;
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ECONNREFUSED";
}

/**
 * Renew before the hour is up. Refresh tokens rotate, so each one is sent at
 * most once: the new one is persisted before anything else happens, one
 * refresh runs at a time per connection, and a failure that may have reached
 * the server leaves the connection unusable — the user reconnects.
 */
async function refresh(response: ServerResponse): Promise<void> {
  if (connection?.blocked) {
    send(response, 409, `<p>This connection can no longer be refreshed. <a href="/connect">Connect again</a></p>`);
    return;
  }
  const refreshToken = connection?.tokens.refresh_token;
  if (!refreshToken) {
    send(response, 400, "<p>No refresh token — was `offline_access` granted?</p>");
    return;
  }
  refreshing ??= client.oauth
    .refreshToken({ refreshToken, clientId, clientSecret })
    .then(
      (tokens) => {
        connection = { ...connection!, tokens }; // persist before any use
        return tokens;
      },
      (error: unknown) => {
        // `invalid_grant` means the connection is gone; a timeout or a 5xx
        // means it may be. Never send this token again — unless storage has
        // already moved on to a newer one, the user has to reconnect.
        if (!failedBeforeSending(error) && connection?.tokens.refresh_token === refreshToken) {
          connection.blocked ??= "unusable";
        }
        throw error;
      },
    )
    .finally(() => {
      refreshing = undefined;
    });
  const tokens = await refreshing;
  send(response, 200, `<p>Renewed. Expires in ${tokens.expires_in}s.</p>`);
}

/**
 * Revoke rather than merely forgetting the token. No refresh may start once a
 * disconnect begins, and the one in flight persists its token first, so the
 * token revoked is the latest one saved — never a retired copy. A failed
 * revocation keeps the connection blocked, so the disconnect can be retried.
 */
async function disconnect(response: ServerResponse): Promise<void> {
  if (connection) connection.blocked = "disconnecting";
  await refreshing?.catch(() => undefined);
  const refreshToken = connection?.tokens.refresh_token;
  const token = refreshToken ?? connection?.tokens.access_token;
  if (token) {
    const tokenTypeHint = refreshToken ? "refresh_token" : "access_token";
    await client.oauth.revokeToken({ token, tokenTypeHint, clientId, clientSecret });
  }
  connection = undefined;
  send(response, 200, "<p>Disconnected.</p>");
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
  switch (url.pathname) {
    case "/":
      return send(response, 200, `<p><a href="/connect">Connect Assinafy</a></p>`);
    case "/connect":
      return start(response);
    case new URL(redirectUri).pathname:
      return callback(url, response);
    case "/documents":
      return listDocuments(response);
    case "/refresh":
      return refresh(response);
    case "/disconnect":
      return disconnect(response);
    default:
      return send(response, 404, "<p>Not found.</p>");
  }
}

createServer((request, response) => {
  void route(request, response).catch((error: unknown) => {
    // `OAuthError` names the OAuth failure; `ApiError` covers everything else.
    // Neither message is meant for an end user — log it, show a plain one.
    if (error instanceof OAuthError) {
      console.error(`OAuth ${error.error}: ${error.message}`);
      send(response, 400, `<p>Could not connect: <code>${error.error}</code>. <a href="/connect">Connect again</a></p>`);
    } else if (error instanceof ApiError && error.status === 401) {
      // Access token expired or revoked: refresh once, reconnect if that fails.
      send(response, 401, `<p>Access expired. <a href="/refresh">Refresh</a>, or <a href="/connect">connect again</a> if that fails.</p>`);
    } else if (error instanceof ApiError) {
      console.error(`API ${error.status}: ${error.message}`);
      send(response, 502, "<p>The Assinafy API rejected the request.</p>");
    } else {
      console.error(error);
      send(response, 500, "<p>Unexpected error.</p>");
    }
  });
}).listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT} — redirect URI ${redirectUri}`);
});
