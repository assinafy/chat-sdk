import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { URL } from "node:url";

const entries = ["index", "client/index", "cards/index", "adapters/index", "state/index", "ai/index"];
const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

for (const entry of entries) {
  const esm = await import(new URL(`../dist/${entry}.js`, import.meta.url));
  const cjs = require(`../dist/${entry}.cjs`);
  assert.ok(Object.keys(esm).length, `${entry} ESM exports are empty`);
  assert.deepEqual(Object.keys(cjs).sort(), Object.keys(esm).sort(), `${entry} CJS/ESM exports differ`);

  const subpath = entry === "index" ? "." : `./${entry.replace("/index", "")}`;
  const exported = pkg.exports[subpath];
  assert.equal(exported.import.types, `./dist/${entry}.d.ts`);
  assert.equal(exported.import.default, `./dist/${entry}.js`);
  assert.equal(exported.require.types, `./dist/${entry}.d.cts`);
  assert.equal(exported.require.default, `./dist/${entry}.cjs`);
}

const { AssinafyClient } = await import(new URL("../dist/client/index.js", import.meta.url));
const client = new AssinafyClient({ baseUrl: "https://example.com/v1" });
assert.ok(client.users, "UsersResource is missing from the built client");

// The SDK version reaches the User-Agent two ways: tsup's build-time `define`
// for the bundle, and a literal fallback in the source for un-bundled use.
// Both must track package.json, so assert each against it rather than trusting
// that a release remembered to update them.
let sentHeaders;
const versioned = new AssinafyClient({
  baseUrl: "https://example.com/v1",
  fetch: async (_url, init) => {
    sentHeaders = new Headers(init.headers);
    return new Response(JSON.stringify({ status: 200, message: "", data: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
});
await versioned.documents.statuses();
assert.equal(
  sentHeaders.get("user-agent"),
  `@assinafy/chat-sdk/${pkg.version}`,
  "built User-Agent does not carry the package.json version",
);

const httpSource = readFileSync(new URL("../src/client/http.ts", import.meta.url), "utf8");
const fallback = /__SDK_VERSION__\s*:\s*"([^"]+)"/.exec(httpSource);
assert.ok(fallback, "could not find the un-bundled SDK version fallback in src/client/http.ts");
assert.equal(fallback[1], pkg.version, "src/client/http.ts version fallback is stale");
