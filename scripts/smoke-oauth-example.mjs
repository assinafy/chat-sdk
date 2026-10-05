import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout, clearTimeout } from "node:timers";

const portProbe = createServer().listen(0, "127.0.0.1");
await once(portProbe, "listening");
const port = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));
const server = spawn(process.execPath, ["--import", "tsx", "examples/oauth-connect.ts"], {
  env: {
    ...process.env,
    PORT: String(port),
    ASSINAFY_CLIENT_ID: "example-client",
    ASSINAFY_CLIENT_SECRET: "",
    ASSINAFY_REDIRECT_URI: "https://example.test/oauth/callback",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const deadline = setTimeout(() => server.kill(), 10_000);
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
  console.log("OAuth example: methods, origin checks, callback state, and response headers passed.");
} finally {
  clearTimeout(deadline);
  server.kill();
  if (server.exitCode === null && server.signalCode === null) await once(server, "exit");
}
