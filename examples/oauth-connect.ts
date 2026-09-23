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
 */
let connection: { tokens: OAuthTokenResponse; accountId?: string } | undefined;

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
 * Renew before the hour is up. Refresh tokens rotate: the new one must be
 * persisted before anything else happens, one refresh at a time per
 * connection, and a timeout means "it may have worked" — re-read the stored
 * token instead of retrying with the old one.
 */
async function refresh(response: ServerResponse): Promise<void> {
  const refreshToken = connection?.tokens.refresh_token;
  if (!refreshToken) {
    send(response, 400, "<p>No refresh token — was `offline_access` granted?</p>");
    return;
  }
  const tokens = await client.oauth.refreshToken({ refreshToken, clientId, clientSecret });
  connection = { ...connection!, tokens };
  send(response, 200, `<p>Renewed. Expires in ${tokens.expires_in}s.</p>`);
}

/** Revoke rather than merely forgetting the token. */
async function disconnect(response: ServerResponse): Promise<void> {
  const token = connection?.tokens.refresh_token ?? connection?.tokens.access_token;
  if (token) {
    await client.oauth.revokeToken({ token, tokenTypeHint: "refresh_token", clientId, clientSecret });
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
      send(response, 400, `<p>Could not connect: <code>${error.error}</code></p>`);
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
