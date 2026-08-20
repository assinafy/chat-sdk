# @assinafy/chat-sdk

[![CI](https://github.com/assinafy/chat-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/assinafy/chat-sdk/actions/workflows/ci.yml)
[![CodeQL](https://github.com/assinafy/chat-sdk/actions/workflows/codeql.yml/badge.svg)](https://github.com/assinafy/chat-sdk/actions/workflows/codeql.yml)
[![npm version](https://img.shields.io/npm/v/@assinafy/chat-sdk.svg)](https://www.npmjs.com/package/@assinafy/chat-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A TypeScript SDK for the Assinafy v1 document-signing API and for chat-based
signing workflows.

The client covers all **89 operations across 67 paths** in the production
OpenAPI snapshot checked on 2026-08-20. It also provides chat orchestration,
renderable cards, adapter and state contracts, an in-memory test adapter, and
provider-neutral AI tool definitions.

## Documentation

- [API reference](./docs/API_REFERENCE.md) — every public resource method,
  authentication, complete request/response examples, raw downloads, errors,
  chat/cards/adapters/state, and all 36 AI tools.
- [API coverage](./docs/API_COVERAGE.md) — all 89 production operations with
  exact method, path, authentication, request, response, and SDK mapping.
- [Official Assinafy API documentation](https://api.assinafy.com.br/v1/docs).

The coverage snapshot is OpenAPI 3.0.0 / API document version 1.0.0, SHA-256
`44da834c27173a3739d491fdacbb48decf9a170bd776a1c4edb4d0d4b108c22f`.

## Runtime scope

Use **Node.js 24 LTS** for server applications and repository examples.

The package offers focused subpath imports:

| Import | Purpose | Runtime scope |
| --- | --- | --- |
| `@assinafy/chat-sdk/client` | Assinafy v1 REST client | Node 24, Bun, Deno, and modern browsers with standard Fetch APIs |
| `@assinafy/chat-sdk/cards` | Card types, builders, renderers | Platform-neutral |
| `@assinafy/chat-sdk/adapters` | Adapter contracts, memory adapter, HMAC verification | Node.js; webhook verification imports `node:crypto` |
| `@assinafy/chat-sdk/state` | State contract and in-memory implementation | Platform-neutral |
| `@assinafy/chat-sdk/ai` | Provider-neutral tool descriptors and message helpers | Platform-neutral |
| `@assinafy/chat-sdk` | All primary bot-building exports | Node.js because the root includes webhook helpers |

Browser bundles that only need the REST client should import the `/client`
subpath instead of the package root.

## Installation

From npm:

```bash
npm install @assinafy/chat-sdk
```

The same release is also published to GitHub Packages. Configure the Assinafy
scope in a project-local `.npmrc`:

```ini
@assinafy:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Then install normally:

```bash
npm install @assinafy/chat-sdk
```

## Assinafy client quick start

```ts
import { AssinafyClient, ApiError } from "@assinafy/chat-sdk/client";

const accountId = process.env.ASSINAFY_ACCOUNT_ID;
if (!accountId) throw new Error("ASSINAFY_ACCOUNT_ID is required");
const apiKey = process.env.ASSINAFY_API_KEY;
if (!apiKey) throw new Error("ASSINAFY_API_KEY is required");

const client = new AssinafyClient({
  apiKey,
  accountId,
  baseUrl: "https://sandbox.assinafy.com.br/v1", // omit for production
});

try {
  const { data: documents, pagination } = await client.documents.list(accountId, {
    status: "pending_signature",
    perPage: 20,
  });
  console.log(documents, pagination);
} catch (error) {
  if (error instanceof ApiError) {
    console.error(error.status, error.method, error.path, error.body);
  }
  throw error;
}
```

Authentication options are mutually exclusive:

```ts
new AssinafyClient({ apiKey: "api-key" });
new AssinafyClient({ accessToken: "bearer-token" });
const client = AssinafyClient.fromEnv();
```

`fromEnv()` reads `ASSINAFY_API_KEY` or `ASSINAFY_ACCESS_TOKEN`, plus the
optional `ASSINAFY_BASE_URL` and `ASSINAFY_ACCOUNT_ID`. It can also return an
unauthenticated client for login and public signing operations.

## Common signing workflow

```ts
import { readFile } from "node:fs/promises";
import { AssinafyClient } from "@assinafy/chat-sdk/client";

const client = AssinafyClient.fromEnv();
const accountId = client.accountId;
if (!accountId) throw new Error("ASSINAFY_ACCOUNT_ID is required");
if (!process.env.ASSINAFY_API_KEY && !process.env.ASSINAFY_ACCESS_TOKEN) {
  throw new Error("ASSINAFY_API_KEY or ASSINAFY_ACCESS_TOKEN is required");
}

const signer = await client.signers.create(accountId, {
  full_name: "Aline Costa",
  email: "signer@example.com",
});

const document = await client.documents.upload(accountId, {
  filename: "contract.pdf",
  body: await readFile("contract.pdf"),
  contentType: "application/pdf",
});

const assignment = await client.assignments.create(document.id, {
  method: "virtual",
  signers: [
    {
      id: signer.id,
      verification_method: "Email",
      notification_methods: ["Email"],
      step: 1,
    },
  ],
  message: "Please sign by Friday.",
  expires_at: "2026-12-31T23:59:59Z",
});

console.log(assignment.signing_urls);
```

See the [API reference](./docs/API_REFERENCE.md) for collect assignments,
positioned fields, templates, estimates, retries, signing, and complete payloads.

## Canonical tags and public tokens

Document-tag operations use tag IDs:

```ts
const tag = await client.tags.create(accountId, {
  name: "Legal",
  color: "#2563EB",
});

await client.tags.setForDocument(accountId, document.id, [tag.id]);
await client.tags.addToDocument(accountId, document.id, [tag.id]);
await client.tags.removeFromDocument(accountId, document.id, tag.id);
```

The production public-token request uses `{ email }`:

```ts
const publicClient = new AssinafyClient();
await publicClient.documents.sendPublicToken(document.id, {
  email: "signer@example.com",
});
```

Older deployments may accept tag names or `{ recipient, channel }`. Those are
explicitly documented as [live compatibility extensions](./docs/API_REFERENCE.md#live-compatibility-extensions),
not the canonical production contract.

## Responses and downloads

JSON methods remove Assinafy's `{ status, message, data }` envelope. A resource
method returns `data` directly. Paginated methods return:

```json
{
  "data": [{ "id": "resource-id" }],
  "pagination": {
    "currentPage": 1,
    "pageCount": 1,
    "perPage": 20,
    "totalCount": 1
  }
}
```

Methods that intentionally discard a success body resolve with `undefined`.
Artifact methods return the native `Response` so callers can stream or buffer:

```ts
const response = await client.documents.download(document.id, "original");
const bytes = new Uint8Array(await response.arrayBuffer());
```

Download failures still throw `ApiError`; only the successful body remains raw.

Every request and response shape is shown in the
[API reference](./docs/API_REFERENCE.md#request-and-response-payloads).

## Sandbox compatibility note

Sandbox verification on 2026-08-20 found deployment drift from production:

- Account creation succeeds with `{ name }`, while the sandbox rejects the
  production-optional `notification_sender_type` field.
- Canonical public-token `{ email }` returns `400`; the SDK retries once with
  exactly `{ recipient: email, channel: "email" }`.
- Document-tag values are treated as names—even an existing tag ID is used as
  a new tag name. Production code should continue to send canonical IDs.
- `client.assignments.list()` returns `400` with an API key because the route
  lacks a logged-in user's “current account” context; use a bearer token or the
  assignment expanded by `client.documents.get(documentId)`.
- Account stats, user stats, and user notification-preference routes returned
  `404`; their SDK methods remain because all are published production routes.

`client.templates.get(accountId, templateId)` is retained for tested live
compatibility, but its detail route is absent from the current 89-operation
production OpenAPI snapshot. Treat it as deployment-specific.

## Chat quick start

```ts
import {
  AssinafyClient,
  Card,
  Chat,
  DocumentPreview,
  MemoryStateAdapter,
  createMemoryAdapter,
} from "@assinafy/chat-sdk";

const client = AssinafyClient.fromEnv();
if (!process.env.ASSINAFY_API_KEY && !process.env.ASSINAFY_ACCESS_TOKEN) {
  throw new Error("ASSINAFY_API_KEY or ASSINAFY_ACCESS_TOKEN is required");
}
const memory = createMemoryAdapter();
const chat = new Chat({
  userName: "Assinafy Bot",
  adapters: { memory },
  state: new MemoryStateAdapter(),
  client,
});

chat.onCommand("status", async (thread, message) => {
  const documentId = message.text.replace(/^[/!]status\s*/i, "").trim();
  const document = await client.documents.get(documentId);
  await thread.post(
    Card({
      title: "Document status",
      children: [
        DocumentPreview({
          documentId: document.id,
          name: document.name,
          status: document.status,
          signingUrl: document.signing_url ?? undefined,
        }),
      ],
    }),
  );
});

await memory.receive({
  text: "/status doc_01J00000000000000000000000",
  isMention: true,
});
console.log(memory.lastSent);
```

Handler dispatch, the complete card union, adapter contracts, webhook signature
verification, and state methods are documented under
[Chat orchestration](./docs/API_REFERENCE.md#chat-orchestration-api).

## AI tools

`createChatTools(client)` returns 36 stable, provider-neutral JSON Schema tool
descriptors. The SDK does not depend on an LLM provider package.

```ts
import { createChatTools, runTool } from "@assinafy/chat-sdk/ai";

const tools = createChatTools(client, {
  include: ["list_documents", "get_document", "document_activities"],
});

const result = await runTool(tools, "list_documents", {
  status: "pending_signature",
});
```

For Anthropic, pass `input_schema`; for OpenAI-style tools, pass the identical
`parameters` property. See [the complete 36-tool catalog](./docs/API_REFERENCE.md#ai-helper-api)
and the dependency-free
[Anthropic example](https://github.com/assinafy/chat-sdk/blob/main/examples/ai-bot.ts).

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ASSINAFY_API_KEY` | none | API key sent as `X-Api-Key` |
| `ASSINAFY_ACCESS_TOKEN` | none | Alternative bearer token |
| `ASSINAFY_BASE_URL` | `https://api.assinafy.com.br/v1` | Use `https://sandbox.assinafy.com.br/v1` for sandbox |
| `ASSINAFY_ACCOUNT_ID` | none | Default account ID exposed as `client.accountId` |
| `ANTHROPIC_API_KEY` | none | Used only by `examples/ai-bot.ts` |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Optional example model override |

Never commit credentials. Use a dedicated sandbox account and rotate exposed
keys immediately.

## Examples

The examples import repository source directly and are validated by
`tsconfig.examples.json`:

- [`examples/basic-bot.ts`](https://github.com/assinafy/chat-sdk/blob/main/examples/basic-bot.ts) — in-memory `/status` bot.
- [`examples/live-cli.ts`](https://github.com/assinafy/chat-sdk/blob/main/examples/live-cli.ts) — sandbox-backed `/docs` and
  `/status` REPL; validates credentials and account ID before starting.
- [`examples/ai-bot.ts`](https://github.com/assinafy/chat-sdk/blob/main/examples/ai-bot.ts) — native Node 24 `fetch` against
  Anthropic with a complete tool-call/result loop and no additional dependency.

Run an example with the repository development dependencies installed:

```bash
ASSINAFY_API_KEY=... \
ASSINAFY_ACCOUNT_ID=... \
ASSINAFY_BASE_URL=https://sandbox.assinafy.com.br/v1 \
npx tsx examples/live-cli.ts
```

## Development and verification

```bash
npm run typecheck
npm run typecheck:examples
npm run lint
npm run test:unit
npm run test:integration
npm run build
```

Pull-request CI omits credentialed integration tests. Trusted `main` pushes and
manual workflow runs require the sandbox secrets and fail explicitly when they
are missing. The live suite uses disposable resources and exercises account
CRUD/logo, webhook mutation, and template instantiation; run it only against a
dedicated sandbox account. Unit tests and example type-checking require no
network access.

## License

MIT — see [LICENSE](./LICENSE).
