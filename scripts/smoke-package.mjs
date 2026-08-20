import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { URL } from "node:url";

const entries = ["index", "client/index", "cards/index", "adapters/index", "state/index", "ai/index"];
const require = createRequire(import.meta.url);

for (const entry of entries) {
  const esm = await import(new URL(`../dist/${entry}.js`, import.meta.url));
  const cjs = require(`../dist/${entry}.cjs`);
  assert.ok(Object.keys(esm).length, `${entry} ESM exports are empty`);
  assert.deepEqual(Object.keys(cjs).sort(), Object.keys(esm).sort(), `${entry} CJS/ESM exports differ`);
}

const { AssinafyClient } = await import(new URL("../dist/client/index.js", import.meta.url));
const client = new AssinafyClient({ baseUrl: "https://example.com/v1" });
assert.ok(client.users, "UsersResource is missing from the built client");
