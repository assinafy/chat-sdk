import { describe, expect, it, vi } from "vitest";
import { AssinafyClient } from "../../src/client/index.js";
import { ConfigurationError, OAuthError } from "../../src/client/errors.js";

const API = "https://api.assinafy.com.br/v1";
const ISSUER = "https://auth.assinafy.com.br";
const REDIRECT = "https://myapp.example/oauth/callback";

const PROTECTED_RESOURCE = {
  resource: "https://api.assinafy.com.br",
  authorization_servers: [ISSUER],
  scopes_supported: ["documents:read", "documents:write"],
  bearer_methods_supported: ["header"],
};

const AUTH_SERVER = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/oauth/authorize`,
  token_endpoint: `${API}/oauth/token`,
  revocation_endpoint: `${API}/oauth/revoke`,
  userinfo_endpoint: `${API}/oauth/userinfo`,
  code_challenge_methods_supported: ["S256"],
};

const TOKENS = {
  access_token: "at_live_9f2b",
  token_type: "Bearer",
  expires_in: 3600,
  scope: "documents:read documents:write",
  refresh_token: "rt_live_7c1a",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A fetch double that answers by URL, recording every request it is given. */
function routed(routes: Record<string, () => Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const route = routes[new URL(url).pathname];
    if (!route) throw new Error(`unrouted ${url}`);
    return route();
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function discovery() {
  return {
    "/.well-known/oauth-protected-resource": () => json(PROTECTED_RESOURCE),
    "/.well-known/oauth-authorization-server": () => json(AUTH_SERVER),
  };
}

function clientWith(routes: Record<string, () => Response>, apiKey = "workspace-key") {
  const { fetchImpl, calls } = routed(routes);
  return { client: new AssinafyClient({ apiKey, baseUrl: API, fetch: fetchImpl }), calls };
}

async function bodyOf(calls: Array<{ init: RequestInit }>, index = calls.length - 1) {
  return JSON.parse(String(calls[index]!.init.body)) as Record<string, unknown>;
}

describe("OAuthResource discovery", () => {
  it("reads protected-resource metadata from the host root, not /v1", async () => {
    const { client, calls } = clientWith(discovery());
    await expect(client.oauth.getProtectedResourceMetadata()).resolves.toEqual(PROTECTED_RESOURCE);
    expect(calls[0]!.url).toBe("https://api.assinafy.com.br/.well-known/oauth-protected-resource");
  });

  it("discovers the authorization server from the protected resource", async () => {
    const { client, calls } = clientWith(discovery());
    await expect(client.oauth.getAuthorizationServerMetadata()).resolves.toEqual(AUTH_SERVER);
    expect(calls.map((c) => new URL(c.url).origin)).toEqual([
      "https://api.assinafy.com.br",
      ISSUER,
    ]);
  });

  it("never sends the workspace API key to a discovery document", async () => {
    const { client, calls } = clientWith(discovery());
    await client.oauth.getAuthorizationServerMetadata();
    for (const call of calls) {
      expect(new Headers(call.init.headers).has("X-Api-Key")).toBe(false);
    }
  });

  it("rejects metadata whose issuer disagrees with where it was fetched", async () => {
    const { client } = clientWith({
      "/.well-known/oauth-authorization-server": () =>
        json({ ...AUTH_SERVER, issuer: "https://evil.example" }),
    });
    await expect(client.oauth.getAuthorizationServerMetadata(ISSUER)).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });

  it("rejects a non-https issuer", async () => {
    const { client } = clientWith({});
    await expect(client.oauth.getAuthorizationServerMetadata("http://auth.example")).rejects.toThrow(
      /absolute https URL/,
    );
  });

  it("fails when the protected resource lists no authorization server", async () => {
    const { client } = clientWith({
      "/.well-known/oauth-protected-resource": () =>
        json({ ...PROTECTED_RESOURCE, authorization_servers: [] }),
    });
    await expect(client.oauth.getAuthorizationServerMetadata()).rejects.toThrow(
      /lists no authorization server/,
    );
  });
});

describe("createAuthorizationUrl", () => {
  it("builds a PKCE authorization URL with every required parameter", async () => {
    const { client } = clientWith(discovery());
    const request = await client.oauth.createAuthorizationUrl({
      clientId: "app-1",
      redirectUri: REDIRECT,
      scopes: ["documents:read", "documents:read", "webhooks:write", "offline_access"],
    });

    const url = new URL(request.url);
    expect(url.origin + url.pathname).toBe(`${ISSUER}/oauth/authorize`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "app-1",
      redirect_uri: REDIRECT,
      response_type: "code",
      // Duplicates collapse, order preserved.
      scope: "documents:read webhooks:write offline_access",
      state: request.state,
      code_challenge: request.codeChallenge,
      code_challenge_method: "S256",
      resource: "https://api.assinafy.com.br",
    });
    expect(request.codeVerifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(request.issuer).toBe(ISSUER);
    expect(request.nonce).toBeUndefined();
  });

  it("derives the S256 challenge from the verifier", async () => {
    const { client } = clientWith(discovery());
    // RFC 7636 appendix B's worked example.
    const request = await client.oauth.createAuthorizationUrl({
      clientId: "app-1",
      redirectUri: REDIRECT,
      scopes: ["documents:read"],
      codeVerifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      authorizationEndpoint: `${ISSUER}/oauth/authorize`,
      issuer: ISSUER,
    });
    expect(request.codeChallenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("mints a fresh verifier and state per attempt", async () => {
    const { client } = clientWith(discovery());
    const options = { clientId: "app-1", redirectUri: REDIRECT, scopes: ["documents:read"] };
    const [a, b] = await Promise.all([
      client.oauth.createAuthorizationUrl(options),
      client.oauth.createAuthorizationUrl(options),
    ]);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.state).not.toBe(b.state);
  });

  it("adds a generated nonce and a prompt when asked", async () => {
    const { client } = clientWith(discovery());
    const request = await client.oauth.createAuthorizationUrl({
      clientId: "app-1",
      redirectUri: REDIRECT,
      scopes: ["openid"],
      nonce: true,
      prompt: "consent",
      resource: null,
    });
    const url = new URL(request.url);
    expect(url.searchParams.get("nonce")).toBe(request.nonce);
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.has("resource")).toBe(false);
  });

  it("skips discovery when the endpoint and issuer are supplied", async () => {
    const { client, calls } = clientWith({});
    await client.oauth.createAuthorizationUrl({
      clientId: "app-1",
      redirectUri: REDIRECT,
      scopes: ["documents:read"],
      authorizationEndpoint: `${ISSUER}/oauth/authorize`,
      issuer: ISSUER,
    });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["a missing client id", { clientId: "", redirectUri: REDIRECT, scopes: ["documents:read"] }],
    ["a plain-http redirect", { clientId: "a", redirectUri: "http://x.example/cb", scopes: ["documents:read"] }],
    ["a redirect with a fragment", { clientId: "a", redirectUri: `${REDIRECT}#x`, scopes: ["documents:read"] }],
    ["an empty scope list", { clientId: "a", redirectUri: REDIRECT, scopes: [] }],
    ["a scope containing whitespace", { clientId: "a", redirectUri: REDIRECT, scopes: ["a b"] }],
    ["a short code verifier", { clientId: "a", redirectUri: REDIRECT, scopes: ["documents:read"], codeVerifier: "tooshort" }],
    ["a non-https resource", { clientId: "a", redirectUri: REDIRECT, scopes: ["documents:read"], resource: "http://x.example" }],
  ])("rejects %s", async (_label, options) => {
    const { client } = clientWith(discovery());
    await expect(
      client.oauth.createAuthorizationUrl({
        ...options,
        authorizationEndpoint: `${ISSUER}/oauth/authorize`,
        issuer: ISSUER,
      }),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });
});

describe("readAuthorizationCallback", () => {
  const expected = { state: "s-1234567890", issuer: ISSUER };

  it("accepts a full callback URL", () => {
    const { client } = clientWith({});
    expect(
      client.oauth.readAuthorizationCallback(
        `${REDIRECT}?code=abc&state=s-1234567890&iss=${encodeURIComponent(ISSUER)}`,
        expected,
      ),
    ).toEqual({ code: "abc", state: "s-1234567890", issuer: ISSUER });
  });

  it.each([
    ["a bare query string", "code=abc&state=s-1234567890"],
    ["URLSearchParams", new URLSearchParams("code=abc&state=s-1234567890")],
    ["a URL object", new URL(`${REDIRECT}?code=abc&state=s-1234567890`)],
    ["an Express query object", { code: "abc", state: "s-1234567890" }],
    ["a repeated query key", { code: ["abc", "zzz"], state: "s-1234567890" }],
  ])("accepts %s", (_label, params) => {
    const { client } = clientWith({});
    expect(client.oauth.readAuthorizationCallback(params, expected).code).toBe("abc");
  });

  it("surfaces a declined consent as access_denied", () => {
    const { client } = clientWith({});
    try {
      client.oauth.readAuthorizationCallback(
        "error=access_denied&error_description=User+declined&state=s-1234567890",
        expected,
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(OAuthError);
      expect(error).toMatchObject({ error: "access_denied", errorDescription: "User declined" });
    }
  });

  it.each([
    ["a mismatched state", "code=abc&state=someone-elses"],
    ["a state of a different length", "code=abc&state=s-1"],
    ["a mismatched issuer", "code=abc&state=s-1234567890&iss=https%3A%2F%2Fevil.example"],
    ["a missing code", "state=s-1234567890"],
  ])("rejects %s", (_label, query) => {
    const { client } = clientWith({});
    expect(() => client.oauth.readAuthorizationCallback(query, expected)).toThrow(OAuthError);
  });

  it("requires the caller to supply the expected state", () => {
    const { client } = clientWith({});
    expect(() =>
      client.oauth.readAuthorizationCallback("code=abc", { state: "" }),
    ).toThrow(ConfigurationError);
  });

  it("rejects callback parameters that are not a URL, string, or object", () => {
    const { client } = clientWith({});
    expect(() =>
      client.oauth.readAuthorizationCallback(null as never, expected),
    ).toThrow(ConfigurationError);
  });
});

describe("token endpoint", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

  it("exchanges a code without leaking the workspace API key", async () => {
    const { client, calls } = clientWith({ "/v1/oauth/token": () => json(TOKENS) });
    await expect(
      client.oauth.exchangeCode({
        code: "the-code",
        codeVerifier: verifier,
        redirectUri: REDIRECT,
        clientId: "app-1",
        clientSecret: "secret-1",
      }),
    ).resolves.toEqual(TOKENS);

    expect(await bodyOf(calls)).toEqual({
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: REDIRECT,
      code_verifier: verifier,
      client_id: "app-1",
      client_secret: "secret-1",
      resource: "https://api.assinafy.com.br",
    });
    expect(new Headers(calls[0]!.init.headers).has("X-Api-Key")).toBe(false);
  });

  it("omits client_secret for public applications", async () => {
    const { client, calls } = clientWith({ "/v1/oauth/token": () => json(TOKENS) });
    await client.oauth.exchangeCode({
      code: "the-code",
      codeVerifier: verifier,
      redirectUri: REDIRECT,
      clientId: "app-1",
    });
    expect(await bodyOf(calls)).not.toHaveProperty("client_secret");
  });

  it("refreshes a token", async () => {
    const rotated = { ...TOKENS, refresh_token: "rt_live_rotated" };
    const { client, calls } = clientWith({ "/v1/oauth/token": () => json(rotated) });
    await expect(
      client.oauth.refreshToken({ refreshToken: "rt_live_7c1a", clientId: "app-1", resource: null }),
    ).resolves.toEqual(rotated);
    expect(await bodyOf(calls)).toEqual({
      grant_type: "refresh_token",
      refresh_token: "rt_live_7c1a",
      client_id: "app-1",
    });
  });

  it("maps a token-endpoint failure to OAuthError", async () => {
    const { client } = clientWith({
      "/v1/oauth/token": () =>
        json({ error: "invalid_grant", error_description: "Code expired" }, 400),
    });
    await expect(
      client.oauth.refreshToken({ refreshToken: "stale", clientId: "app-1" }),
    ).rejects.toMatchObject({
      name: "OAuthError",
      status: 400,
      error: "invalid_grant",
      errorDescription: "Code expired",
      message: "Code expired",
    });
  });

  it("rejects a 2xx that carries no access token", async () => {
    const { client } = clientWith({ "/v1/oauth/token": () => json({ token_type: "Bearer" }) });
    await expect(
      client.oauth.refreshToken({ refreshToken: "rt", clientId: "app-1" }),
    ).rejects.toThrow(/no access_token/);
  });

  it.each([
    ["a missing code", () => ({ code: "", codeVerifier: verifier, redirectUri: REDIRECT, clientId: "a" })],
    ["a malformed verifier", () => ({ code: "c", codeVerifier: "short", redirectUri: REDIRECT, clientId: "a" })],
    ["a missing client id", () => ({ code: "c", codeVerifier: verifier, redirectUri: REDIRECT, clientId: "" })],
    ["an empty client secret", () => ({ code: "c", codeVerifier: verifier, redirectUri: REDIRECT, clientId: "a", clientSecret: "" })],
  ])("rejects %s before any request", async (_label, build) => {
    const { client, calls } = clientWith({});
    await expect(client.oauth.exchangeCode(build())).rejects.toBeInstanceOf(ConfigurationError);
    expect(calls).toHaveLength(0);
  });

  it("omits the resource indicator on a loopback base URL", async () => {
    const { fetchImpl, calls } = routed({ "/v1/oauth/token": () => json(TOKENS) });
    const local = new AssinafyClient({ baseUrl: "http://localhost:3000/v1", fetch: fetchImpl });
    await local.oauth.refreshToken({ refreshToken: "rt", clientId: "app-1" });
    expect(await bodyOf(calls)).not.toHaveProperty("resource");
  });
});

describe("revokeToken", () => {
  it("posts the token and its hint, and resolves on success", async () => {
    const { client, calls } = clientWith({ "/v1/oauth/revoke": () => new Response(null, { status: 200 }) });
    await expect(
      client.oauth.revokeToken({
        token: "rt_live_7c1a",
        tokenTypeHint: "refresh_token",
        clientId: "app-1",
        clientSecret: "secret-1",
      }),
    ).resolves.toBeUndefined();
    expect(await bodyOf(calls)).toEqual({
      token: "rt_live_7c1a",
      token_type_hint: "refresh_token",
      client_id: "app-1",
      client_secret: "secret-1",
    });
  });

  it("reports failed client authentication", async () => {
    const { client } = clientWith({
      "/v1/oauth/revoke": () =>
        json({ error: "invalid_client", error_description: "Client authentication failed." }, 401),
    });
    await expect(
      client.oauth.revokeToken({ token: "t", clientId: "app-1" }),
    ).rejects.toMatchObject({ error: "invalid_client", status: 401 });
  });

  it("rejects a missing token before any request", async () => {
    const { client, calls } = clientWith({});
    await expect(client.oauth.revokeToken({ token: "", clientId: "a" })).rejects.toBeInstanceOf(
      ConfigurationError,
    );
    expect(calls).toHaveLength(0);
  });
});

describe("getUserInfo", () => {
  const claims = { sub: "d6zqpbyog2v3", name: "Test Signer", email_verified: true };

  it("uses the client's own credential by default", async () => {
    const { fetchImpl, calls } = routed({ "/v1/oauth/userinfo": () => json(claims) });
    const connected = new AssinafyClient({ accessToken: "at_live_9f2b", baseUrl: API, fetch: fetchImpl });
    await expect(connected.oauth.getUserInfo()).resolves.toEqual(claims);
    expect(new Headers(calls[0]!.init.headers).get("authorization")).toBe("Bearer at_live_9f2b");
  });

  it("presents an explicitly supplied token instead", async () => {
    const { client, calls } = clientWith({ "/v1/oauth/userinfo": () => json(claims) });
    await client.oauth.getUserInfo("at_other");
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get("authorization")).toBe("Bearer at_other");
    expect(headers.has("X-Api-Key")).toBe(false);
  });

  it("names the missing permission from an insufficient_scope challenge", async () => {
    const { client } = clientWith({
      "/v1/oauth/userinfo": () =>
        new Response(JSON.stringify({ status: 403, message: "Forbidden", data: null }), {
          status: 403,
          headers: {
            "content-type": "application/json",
            "www-authenticate":
              'Bearer error="insufficient_scope", scope="openid", resource_metadata="https://api.assinafy.com.br/.well-known/oauth-protected-resource"',
          },
        }),
    });
    await expect(client.oauth.getUserInfo("at_live")).rejects.toMatchObject({
      name: "OAuthError",
      error: "insufficient_scope",
      scope: "openid",
      status: 403,
    });
  });
});
