import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import { setTimeout, clearTimeout } from "node:timers";
import { URLSearchParams } from "node:url";

const issuer = "https://auth.example.test";
const refreshStarted = Promise.withResolvers();
const revokeStarted = Promise.withResolvers();
const providerErrors = [];
const refreshed = [];
const revoked = [];
const documentReads = [];
let heldRefresh;
let heldRevoke;

function json(response, body) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function tokens(id) {
  return { access_token: `access-${id}`, refresh_token: `refresh-${id}`, token_type: "Bearer", expires_in: 3600 };
}

const provider = createHttpServer((request, response) => {
  void (async () => {
    const path = new URL(request.url, "http://localhost").pathname;
    const accountId = request.headers.authorization?.replace(/^Bearer access-/, "").replace(/-next$/, "");
    const envelope = (data) => json(response, { status: 200, message: "", data });
    if (path === "/.well-known/oauth-protected-resource") {
      return json(response, { authorization_servers: [issuer] });
    }
    if (path === "/v1/accounts") return envelope([{ id: accountId }]);
    if (path.endsWith("/documents")) {
      assert.equal(path, `/v1/accounts/${accountId}/documents`);
      documentReads.push(request.headers.authorization);
      return envelope([{ name: accountId, status: "draft" }]);
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const form = new URLSearchParams(body);
    if (path === "/v1/oauth/token") {
      if (form.get("grant_type") === "authorization_code") return json(response, tokens(form.get("code")));
      const token = form.get("refresh_token");
      refreshed.push(token);
      if (token === "refresh-a") {
        heldRefresh = response;
        refreshStarted.resolve();
        return;
      }
      assert.equal(token, "refresh-b");
      return json(response, tokens("b-next"));
    }
    assert.equal(path, "/v1/oauth/revoke");
    revoked.push(form.get("token"));
    if (form.get("token") === "refresh-b-next") {
      heldRevoke = response;
      revokeStarted.resolve();
      return;
    }
    response.writeHead(200).end();
  })().catch((error) => {
    providerErrors.push(error);
    response.writeHead(500).end();
  });
}).listen(0, "127.0.0.1");
await once(provider, "listening");
const providerOrigin = `http://127.0.0.1:${provider.address().port}`;
// Discovery names an HTTPS issuer; all other requests stay on the loopback provider.
const preload = `
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.href === ${JSON.stringify(`${issuer}/.well-known/oauth-authorization-server`)}) {
      return Promise.resolve(Response.json(${JSON.stringify({ issuer, authorization_endpoint: `${issuer}/oauth/authorize` })}));
    }
    if (url.origin !== ${JSON.stringify(providerOrigin)}) throw new Error("External requests are disabled in this test");
    return nativeFetch(input, init);
  };
`;

const portProbe = createServer().listen(0, "127.0.0.1");
await once(portProbe, "listening");
const port = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));
const server = spawn(process.execPath, [
  "--import", `data:text/javascript,${encodeURIComponent(preload)}`,
  "--import", "tsx", "examples/oauth-connect.ts",
], {
  env: {
    PORT: String(port),
    ASSINAFY_BASE_URL: `${providerOrigin}/v1`,
    ASSINAFY_CLIENT_ID: "example-client",
    ASSINAFY_REDIRECT_URI: "https://example.test/oauth/callback",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const deadline = setTimeout(() => {
  server.kill();
  provider.closeAllConnections();
}, 15_000);
try {
  await Promise.race([
    once(server.stdout, "data"),
    once(server, "exit").then(() => { throw new Error("Example exited before listening"); }),
  ]);
  const origin = `http://localhost:${port}`;
  const baseUrl = `http://127.0.0.1:${port}`;
  for (const path of ["/refresh", "/disconnect"]) {
    assert.equal((await fetch(baseUrl + path)).status, 405);
    for (const headers of [{}, { origin: "https://untrusted.example.test" }]) {
      assert.equal((await fetch(baseUrl + path, { method: "POST", headers })).status, 403);
    }
    for (const allowed of [origin, "https://example.test"]) {
      const response = await fetch(baseUrl + path, { method: "POST", headers: { origin: allowed } });
      assert.equal(response.status, path === "/refresh" ? 400 : 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    }
  }
  assert.equal((await fetch(baseUrl + "/oauth/callback?state=unknown")).status, 400);
  assert.equal((await fetch(baseUrl + "/documents", { method: "POST" })).status, 405);

  async function connect(id) {
    const redirect = await fetch(baseUrl + "/connect", { redirect: "manual" });
    assert.equal(redirect.status, 302);
    const state = new URL(redirect.headers.get("location")).searchParams.get("state");
    const query = new URLSearchParams({ code: id, state, iss: issuer });
    const response = await fetch(`${baseUrl}/oauth/callback?${query}`);
    assert.equal(response.status, 200);
    await response.text();
  }
  const post = (path) => fetch(baseUrl + path, { method: "POST", headers: { origin } });

  await connect("a");
  const oldRefresh = post("/refresh");
  await Promise.race([
    refreshStarted.promise,
    oldRefresh.then(() => { throw new Error("The first refresh did not reach the provider"); }),
  ]);
  await connect("b");
  assert.equal((await post("/refresh")).status, 200);
  json(heldRefresh, tokens("a-next"));
  assert.equal((await oldRefresh).status, 200);
  assert.equal((await fetch(baseUrl + "/documents")).status, 200);
  assert.deepEqual(refreshed, ["refresh-a", "refresh-b"]);
  assert.deepEqual(documentReads, ["Bearer access-b-next"]);

  const oldDisconnect = post("/disconnect");
  await Promise.race([
    revokeStarted.promise,
    oldDisconnect.then(() => { throw new Error("Disconnect did not reach revocation"); }),
  ]);
  await connect("c");
  heldRevoke.writeHead(200).end();
  assert.equal((await oldDisconnect).status, 200);
  assert.equal((await fetch(baseUrl + "/documents")).status, 200);
  assert.deepEqual(documentReads, ["Bearer access-b-next", "Bearer access-c"]);
  assert.deepEqual(revoked, ["refresh-b-next"]);
  assert.equal((await post("/disconnect")).status, 200);
  assert.deepEqual(revoked, ["refresh-b-next", "refresh-c"]);
  assert.deepEqual(providerErrors, []);
  console.log("OAuth example: routing, response headers, and concurrent connection lifecycles passed.");
} finally {
  clearTimeout(deadline);
  server.kill();
  if (server.exitCode === null && server.signalCode === null) await once(server, "exit");
  provider.closeAllConnections();
  await new Promise((resolve) => provider.close(resolve));
}
