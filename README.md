# @assinafy/chat-sdk

[![CI](https://github.com/assinafy/chat-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/assinafy/chat-sdk/actions/workflows/ci.yml)
[![CodeQL](https://github.com/assinafy/chat-sdk/actions/workflows/codeql.yml/badge.svg)](https://github.com/assinafy/chat-sdk/actions/workflows/codeql.yml)
[![npm version](https://img.shields.io/npm/v/@assinafy/chat-sdk.svg)](https://www.npmjs.com/package/@assinafy/chat-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> A unified TypeScript SDK for building **chat bots and conversational integrations** on top of the [Assinafy](https://assinafy.com.br) document-signing API.

It includes a typed Assinafy v1 client, chat orchestration primitives, renderable card components, adapter foundations, state helpers, and optional LLM tool definitions.

## Layers

| Layer | Subpath | Purpose |
| --- | --- | --- |
| **Client** | `@assinafy/chat-sdk/client` | Strongly-typed wrapper over every Assinafy v1 endpoint. |
| **Cards** | `@assinafy/chat-sdk/cards` | Declarative rich-message primitives (`Card`, `Text`, `LinkButton`, `Actions`, …) + renderers (text / markdown / HTML). |
| **Adapters** | `@assinafy/chat-sdk/adapters` | `createMemoryAdapter()` factory + `BaseAdapter` for vendors building real platform adapters + webhook-signature helpers. |
| **State** | `@assinafy/chat-sdk/state` | `MemoryStateAdapter` (subscriptions + per-thread KV). Swap in Redis/Postgres for prod. |
| **AI tools** | `@assinafy/chat-sdk/ai` | Provider-agnostic LLM tool definitions wrapping the client (Anthropic + OpenAI tool-call compatible). |

All five layers can be used independently. The top-level `Chat` class composes them.

## Installation

Each release is published to **both** registries.

From npmjs (default):

```bash
npm install @assinafy/chat-sdk
# or
pnpm add @assinafy/chat-sdk
# or
yarn add @assinafy/chat-sdk
```

From GitHub Packages — add a project-local `.npmrc` first so the scope resolves there:

```ini
# .npmrc
@assinafy:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Then `npm install @assinafy/chat-sdk` will pull from GitHub Packages.

Requires Node 20+ (or any runtime with a global `fetch` + `Blob`).

## Quick Start

```ts
import {
  Chat,
  createMemoryAdapter,
  MemoryStateAdapter,
  AssinafyClient,
  Card,
  Text,
  Divider,
  LinkButton,
  DocumentPreview,
  SignerStatus,
} from "@assinafy/chat-sdk";

const client = new AssinafyClient({
  apiKey: process.env.ASSINAFY_API_KEY!,
  accountId: process.env.ASSINAFY_ACCOUNT_ID!,
  baseUrl: "https://sandbox.assinafy.com.br/v1", // omit for production
});

const memory = createMemoryAdapter();

const chat = new Chat({
  userName: "Assinafy Bot",
  adapters: { memory },
  state: new MemoryStateAdapter(),
  client,
});

chat.onCommand("status", async (thread, msg) => {
  const id = msg.text.replace(/^\/status\s*/, "").trim();
  const doc = await client.documents.get(id);
  await thread.post({
    card: Card({
      title: "Document status",
      children: [
        DocumentPreview({
          documentId: doc.id,
          name: doc.name,
          status: doc.status,
          signingUrl: doc.signing_url ?? undefined,
        }),
        Divider(),
        SignerStatus(
          doc.assignment?.summary.signers.map((s) => ({
            name: s.full_name,
            email: s.email,
            completed: s.completed,
          })) ?? [],
        ),
      ],
    }),
    fallbackText: `Document ${doc.name} — ${doc.status}`,
  });
});

// Drive a message through the in-memory adapter:
await memory.receive({ text: "/status 103051797f91ce2d16a548b6a8a6" });
console.log(memory.lastSent);
```

## Handlers

| Handler | When it fires |
| --- | --- |
| `chat.onNewMention((thread, message) => …)` | Inbound message that mentions the bot (or opens a new thread on platforms like email where every inbound message is implicitly addressed). |
| `chat.onSubscribedMessage((thread, message) => …)` | Follow-up message in a thread the bot has previously `thread.subscribe()`d. |
| `chat.onNewMessage(/regex/, (thread, message) => …)` | Any inbound message whose text matches the regex. |
| `chat.onCommand("status", (thread, message) => …)` | Slash-command syntax (`/status`, `!status`). Pass a `RegExp` for full control. |
| `chat.onAction((thread, action) => …)` | Button click / slash-command interaction. |
| `chat.onFallback((thread, message) => …)` | Catch-all when nothing else matched. |

## Posting messages

`thread.post()` accepts:

```ts
await thread.post("plain text");
await thread.post(Card({ title: "Hello", children: [Text("body")] }));
await thread.post({
  card: Card({ title: "Order Confirmed", children: [Text("Your order #1234 has been shipped.")] }),
  fallbackText: "Order #1234 confirmed",
});
```

## Card primitives

Capitalized helpers:

```ts
import {
  Card, Text, CardText, Heading, Divider, Section, Fields, Actions,
  Button, LinkButton, Image, Table, Select, RadioSelect, Option,
  DocumentPreview, SignerStatus, Children,
} from "@assinafy/chat-sdk";

Card({
  title: "Document ready",
  children: Children(
    Heading(2, "Contract.pdf"),
    Text("Bill M asked you to sign."),
    Fields([
      { label: "Status", value: "Pending signature" },
      { label: "Expires", value: "in 7 days" },
    ]),
    Divider(),
    Actions([
      LinkButton({ label: "Sign now", url: doc.signing_url!, style: "primary" }),
      Button({ id: "decline", label: "Decline", value: doc.id, style: "danger" }),
    ]),
  ),
});
```

Lowercase aliases (`card`, `text`, `divider`, …) are also exported for tests and quick scripts.

Generic renderers ship for any adapter:

```ts
import { renderText, renderMarkdown, renderHtml } from "@assinafy/chat-sdk/cards";
const plain = renderText(message);
const md = renderMarkdown(message);
const html = renderHtml(message); // safe — values are escaped
```

## Building a platform adapter

Adapters are constructed with a `createXxxAdapter(config)` factory:

```ts
import { BaseAdapter, type ChatHandle, type OutgoingMessage, type SentMessage } from "@assinafy/chat-sdk/adapters";

export interface SlackAdapterConfig {
  botToken?: string;     // falls back to SLACK_BOT_TOKEN
  signingSecret?: string; // falls back to SLACK_SIGNING_SECRET
}

class SlackAdapter extends BaseAdapter {
  readonly name = "slack";
  // override initialize, postMessage, openDM, editMessage, deleteMessage,
  // addReaction, removeReaction, startTyping as needed
}

export function createSlackAdapter(config: SlackAdapterConfig = {}): SlackAdapter {
  return new SlackAdapter(/* … */);
}
```

The `Chat` constructor calls `adapter.initialize(chat)` once at startup so the adapter can stash a reference. From your webhook handler, parse the request, then call:

```ts
await this.chat!.processMessage(this, normalizedIncomingMessage);
// or
await this.chat!.processAction(this, normalizedIncomingAction);
```

### Webhook signature verification

```ts
import { verifyWebhookSignature, WebhookSignatureError } from "@assinafy/chat-sdk";

// Inside your adapter's webhook handler:
const signature = request.headers.get("x-resend-signature")!;
const body = await request.text();

try {
  verifyWebhookSignature({ secret: process.env.RESEND_WEBHOOK_SECRET!, body, signature });
} catch (err) {
  if (err instanceof WebhookSignatureError) return new Response("invalid", { status: 401 });
  throw err;
}
```

Supports plain HMAC-SHA256 (default), `${timestamp}.${body}` payloads (pass `timestamp`), base64- or hex-encoded signatures, configurable hash algorithm, and an `algo=` prefix on the supplied signature.

### Unsupported operations

Optional methods (`editMessage`, `deleteMessage`, `addReaction`, `removeReaction`, `startTyping`) throw `NotImplementedError` by default — override only what your platform supports.

## The Assinafy client

The client covers the documented Assinafy v1 REST surface — workspace accounts,
signers, documents, tags, templates, fields, assignments, webhooks, and the
signer-facing signing flow. Browser-only OAuth redirect endpoints
(`GET /v1/auth/authenticate`, `GET /v1/login-callback`) are intentionally
omitted because they are not JSON APIs.

Every response is unwrapped from the API's `{ status, message, data }` envelope,
so each method returns the `data` payload directly (list methods return
`{ data, pagination }`).

```ts
// Accounts (workspaces)
const accounts = await client.accounts.list();          // Account[]
const account = await client.accounts.get(accountId);   // Account
await client.accounts.update(accountId, { name: "Acme Inc." });
await client.accounts.getTheme(accountId);               // { account_name, primary_color, secondary_color, logo }
await client.accounts.uploadLogo(accountId, { filename: "logo.png", body: pngBytes });
// await client.accounts.create({ name: "New workspace" });
// await client.accounts.remove(accountId, { force: true });

// Auth
await client.auth.login({ email, password });
await client.auth.createApiKey(password);
await client.auth.getApiKey();
await client.auth.deleteApiKey();
await client.auth.linkSocialLogin({ provider: "google", token: "..." });

// Signers
const page = await client.signers.list(accountId, { search: "alice", perPage: 50 });
const signer = await client.signers.create(accountId, { full_name: "Alice", email: "a@x.com" });
await client.signers.update(accountId, signer.id, { whatsapp_phone_number: "+5511..." });
await client.signers.remove(accountId, signer.id);

// Documents
const doc = await client.documents.upload(accountId, { filename: "contract.pdf", body: pdfBuffer });
const docs = await client.documents.list(accountId, { status: "pending_signature" });
const hits = await client.documents.search(accountId, { search: "contract" }); // lightweight
for await (const d of client.documents.iterate(accountId)) { /* … */ }
await client.documents.rename(doc.id, "Renamed.pdf");   // only before signing starts
await client.documents.activities(doc.id);
const thumb = await client.documents.thumbnail(doc.id); // Response — stream/buffer as needed
await client.documents.remove(doc.id);

// Tags
await client.tags.create(accountId, { name: "important", color: "#ff8800" });
await client.tags.setForDocument(accountId, doc.id, ["important"]);

// Templates
const tpls = await client.templates.list(accountId);
const tpl = await client.templates.get(accountId, tpls.data[0].id); // detail incl. roles + default tags
const newDoc = await client.templates.instantiate(accountId, tpl.id, {
  signers: [{ role_id: tpl.roles![0].id, id: signer.id }],
});

// Assignments — connect signers to a document and start the flow.
const assignment = await client.assignments.create(doc.id, {
  method: "virtual",
  signers: [{ id: signer.id }],
  message: "Please sign by Friday.",
});
await client.assignments.estimateResendCost(doc.id, assignment.id, signer.id);
await client.assignments.resetExpiration(doc.id, assignment.id, "2026-12-31T23:59:59Z");
// assignments.list() needs a bearer token's "current account"; with an API key
// use the per-document assignment on `client.documents.get(id)` instead.

// Fields
const field = await client.fields.create(accountId, { type: "text", name: "Reference" });
await client.fields.validate(accountId, field.id, "ABC-123");
await client.fields.listTypes();

// Webhooks
await client.webhooks.listEventTypes();
await client.webhooks.getSubscription(accountId);
await client.webhooks.listDispatches(accountId, { perPage: 20 });

// Public document and signer flows (signer-access-code is sent as a query param)
await client.documents.publicGet(doc.id);
await client.documents.sendPublicToken(doc.id, { recipient: "signer@example.com", channel: "email" });
await client.documents.verify("SIGNATURE_HASH");
await client.signature.self(accessCode);
await client.signature.verify(accessCode, "123456");     // OTP; resolves or throws
await client.signature.acceptTerms(accessCode);
await client.signature.searchDocuments(signerId, accessCode, "contract");
await client.signature.upload(accessCode, "signature", pngBytes);
```

### Response payloads

Responses are already unwrapped from the `{ status, message, data }` envelope.
Representative shapes (verified against the live sandbox):

```jsonc
// client.documents.get(id) — a document (assignment is populated on GET, null in list())
{
  "id": "103a…", "account_id": "102d…", "template_id": null,
  "name": "contract.pdf", "status": "pending_signature",
  "artifacts": { "original": "https://…/download/original", "thumbnail": "https://…/thumbnail" },
  "is_closed": false, "signing_url": "https://app…/sign/103a…",
  "tags": [], "pages": [{ "id": "…", "number": 1, "height": 1651, "width": 1275, "download_url": "https://…" }],
  "assignment": {
    "id": "…", "sender_email": "you@example.com", "method": "virtual", "expires_at": null,
    "signers": [{ "id": "…", "full_name": "Alice", "email": "a@x.com", "completed": false,
                  "verification_method": "Email", "notification_methods": ["Email"], "step": 1 }],
    "summary": { "signer_count": 1, "completed_count": 0, "signers": [/* … */] },
    "signing_urls": [{ "signer_id": "…", "url": "https://app…/sign/…?email=a%40x.com" }]
  },
  "created_at": "2026-07-17T17:48:53Z", "updated_at": "2026-07-17T17:48:59Z"
}

// client.assignments.estimateCost(id, …) — a cost estimate
{
  "documents": 1, "credits": 0, "needs_extra_document": false, "total_credits": 0,
  "breakdown": [], "document_balance": 90, "credit_balance": 0,
  "has_sufficient_resources": true, "blocking_reason": null, "message": null
}
```

### Pagination

`list()` (and `search()`) methods return `{ data, pagination }`, where
`pagination` is `{ currentPage, pageCount, perPage, totalCount }` read from the
`X-Pagination-*` response headers. To walk every page, use the matching
`iterate()` async iterator.

### Errors

Every non-2xx response is mapped to an `ApiError` with `.status`, `.body`, `.path`, and `.method`.

```ts
import { ApiError } from "@assinafy/chat-sdk";

try {
  await client.documents.remove(id);
} catch (err) {
  if (err instanceof ApiError && err.status === 409) {
    // document is not in a deletable status
  }
}
```

### Retries

Transient failures (429, 5xx, network errors) are retried with exponential backoff. Pass `maxRetries: 0` to disable.

### Authentication

```ts
new AssinafyClient({ apiKey: "..." });           // X-Api-Key header
new AssinafyClient({ accessToken: "..." });      // Bearer header
AssinafyClient.fromEnv();                        // reads ASSINAFY_API_KEY / ASSINAFY_ACCESS_TOKEN
```

## AI tool-calling

`createChatTools(client)` returns provider-agnostic JSON-schema tool descriptors. Compatible with both Anthropic and OpenAI tool-calling.

```ts
import Anthropic from "@anthropic-ai/sdk";
import { createChatTools, runTool, toAiMessages, defaultSystemPrompt } from "@assinafy/chat-sdk/ai";

const tools = createChatTools(client);
const anthropic = new Anthropic();

const response = await anthropic.messages.create({
  model: "claude-sonnet-4-6",
  system: defaultSystemPrompt("Assinafy Bot"),
  messages: toAiMessages(history),
  tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
  max_tokens: 1024,
});

for (const block of response.content) {
  if (block.type === "tool_use") {
    const result = await runTool(tools, block.name, block.input);
    // feed result back as `tool_result` in the next turn
  }
}
```

Restrict the toolset for guard-railed bots:

```ts
const readonly = createChatTools(client, { include: [
  "list_signers", "get_signer", "list_documents", "get_document", "document_activities",
] });
```

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ASSINAFY_API_KEY` | – | API key (`X-Api-Key`) |
| `ASSINAFY_ACCESS_TOKEN` | – | Alternative: bearer token |
| `ASSINAFY_BASE_URL` | `https://api.assinafy.com.br/v1` | `https://sandbox.assinafy.com.br/v1` for sandbox |
| `ASSINAFY_ACCOUNT_ID` | – | Default account id |

```ts
const client = AssinafyClient.fromEnv();
```

## Testing

```bash
npm test            # full suite (unit + integration)
npm run test:unit   # unit only — no credentials needed
npm run test:integration
```

Integration tests skip themselves automatically when `ASSINAFY_API_KEY` / `ASSINAFY_ACCOUNT_ID` aren't set, so the suite is safe to run in CI without secrets.

## Examples

See [`examples/`](./examples) for runnable scripts:

- [`basic-bot.ts`](./examples/basic-bot.ts) — minimal in-memory bot answering status questions.
- [`ai-bot.ts`](./examples/ai-bot.ts) — same bot, with an Anthropic tool-calling loop.
- [`live-cli.ts`](./examples/live-cli.ts) — REPL that runs against the real sandbox.

## License

MIT — see [LICENSE](./LICENSE).
