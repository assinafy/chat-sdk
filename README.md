# @assinafy/chat-sdk

[![CI](https://github.com/assinafy/chat-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/assinafy/chat-sdk/actions/workflows/ci.yml)
[![CodeQL](https://github.com/assinafy/chat-sdk/actions/workflows/codeql.yml/badge.svg)](https://github.com/assinafy/chat-sdk/actions/workflows/codeql.yml)
[![npm version](https://img.shields.io/npm/v/@assinafy/chat-sdk.svg)](https://www.npmjs.com/package/@assinafy/chat-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A TypeScript SDK for the Assinafy v1 document-signing API and for building
chat-based signing workflows on top of it.

This document is written to be read straight through. It starts with what the
package contains, installs and configures it, makes a first request, explains
how responses and errors behave, then walks the complete document-signing
lifecycle before moving on to the chat, card, and AI layers. Each section
assumes the one before it.

---

## 1. What is in the package

The SDK is one package with two halves that can be used independently.

**The API client** covers the Assinafy v1 REST API: **89 operations across 67
paths**, grouped into eleven resources — accounts, authentication, users,
signers, documents, tags, templates, assignments, fields, the signer-facing
signature flow, and webhooks. Every operation is typed, and the transport
handles authentication, the response envelope, pagination, rate-limit metadata,
retries, and error mapping.

**The chat layer** turns those operations into conversational workflows: a
`Chat` orchestrator that routes inbound messages to handlers, a `Thread` view
handed to every handler, an adapter contract for connecting messaging
platforms, a pluggable state contract for subscriptions and per-thread storage,
a declarative card system with text, Markdown, and HTML renderers, and 36
provider-neutral tool descriptors for LLM tool calling.

Two reference documents accompany this one and go deeper than it does:

- **[API reference](./docs/API_REFERENCE.md)** — every public method with its
  authentication mode, complete request and response payloads, the chat, card,
  adapter, and state surfaces, and the full AI tool catalog.
- **[API operation index](./docs/API_COVERAGE.md)** — all 89 published
  operations mapped to their SDK method, plus the places where the SDK's HTTP
  surface goes beyond the published document.

The authoritative upstream contract is the
[official Assinafy API documentation](https://api.assinafy.com.br/v1/docs).

---

## 2. Requirements and runtime scope

Server applications and the examples in this repository target **Node.js 24
LTS**, which is what the package's `engines` field requires and what CI runs.

Not every entry point needs Node. The package ships focused subpaths so a
browser or edge bundle can pull in only the REST client:

| Import | Contents | Runs on |
| --- | --- | --- |
| `@assinafy/chat-sdk/client` | Assinafy v1 REST client | Node 24, Bun, Deno, and browsers with standard Fetch APIs |
| `@assinafy/chat-sdk/cards` | Card types, builders, renderers | Any JavaScript runtime |
| `@assinafy/chat-sdk/state` | State contract and in-memory implementation | Any JavaScript runtime |
| `@assinafy/chat-sdk/ai` | Tool descriptors and message helpers | Any JavaScript runtime |
| `@assinafy/chat-sdk/adapters` | Adapter contracts, memory adapter, HMAC verification | Node.js — webhook verification imports `node:crypto` |
| `@assinafy/chat-sdk` | Everything above | Node.js, because the root re-exports the webhook helpers |

The rule of thumb: if a bundle only talks to the API, import
`@assinafy/chat-sdk/client` and nothing else. Both ES modules and CommonJS are
published, with type declarations for each.

---

## 3. Installation

From npm:

```bash
npm install @assinafy/chat-sdk
```

Every release is published to GitHub Packages as well. To install from there,
point the `@assinafy` scope at that registry in a project-local `.npmrc`:

```ini
@assinafy:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Then install normally — the scope mapping does the routing:

```bash
npm install @assinafy/chat-sdk
```

---

## 4. Configuration and authentication

The client authenticates with either a long-lived API key sent as `X-Api-Key`,
or a bearer access token obtained from `auth.login()`. The two are mutually
exclusive; passing both throws `ConfigurationError`.

```ts
import { AssinafyClient } from "@assinafy/chat-sdk/client";

new AssinafyClient({ apiKey: "api-key" });
new AssinafyClient({ accessToken: "bearer-token" });
```

`AssinafyClient.fromEnv()` reads the same settings from the environment, which
is what the examples and the test suite use:

| Variable | Default | Purpose |
| --- | --- | --- |
| `ASSINAFY_API_KEY` | none | API key, sent as `X-Api-Key` |
| `ASSINAFY_ACCESS_TOKEN` | none | Bearer token, used instead of an API key |
| `ASSINAFY_BASE_URL` | `https://api.assinafy.com.br/v1` | Set to `https://sandbox.assinafy.com.br/v1` for sandbox |
| `ASSINAFY_ACCOUNT_ID` | none | Default account id, readable back as `client.accountId` |

Constructing with neither credential is deliberate and supported: an
unauthenticated client is what you use for `auth.login()`, public document
verification, and the signer-facing endpoints that authenticate with a signer
access code instead.

Beyond credentials, the constructor accepts transport settings — a custom
`fetch`, `maxRetries`, `retryBaseDelayMs`, a `userAgent` override, and an
`onRateLimit` observer. All are optional and all are forwarded to the
underlying `HttpClient`.

Never commit credentials. Use a dedicated sandbox account for development and
rotate any key that is exposed.

---

## 5. A first request

Every resource method takes the identifiers it needs as explicit arguments, so
the client itself stays stateless:

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

The destructured `{ data, pagination }` and the `ApiError` branch are both
consequences of how the transport works, which is the next section.

---

## 6. How responses, pagination, downloads, and errors behave

Understanding these four behaviors makes the rest of the SDK predictable,
because every resource method inherits them.

### Responses are unwrapped

Assinafy wraps JSON responses in an envelope:

```json
{ "status": 200, "message": "Success", "data": { "id": "resource-id" } }
```

The transport removes it. A resource method returns `data` directly — here,
`{ "id": "resource-id" }`. A valid envelope carrying no `data`, and any `204`,
resolve to `undefined`; methods documented as returning `void` are exactly
those.

### Lists are paginated

Methods that return a collection return both the items and the pagination
metadata read from the `X-Pagination-*` response headers:

```json
{
  "data": [{ "id": "resource-id" }],
  "pagination": { "currentPage": 1, "pageCount": 1, "perPage": 20, "totalCount": 1 }
}
```

`page` must be a positive integer and `perPage` must be between 1 and 100; the
SDK rejects values outside those bounds before the request is sent, and encodes
`perPage` as the API's `per-page`. When you would otherwise write a paging
loop, `documents.iterate()` and `signers.iterate()` are async iterators that
walk every page for you:

```ts
for await (const document of client.documents.iterate(accountId, { status: "certificated" })) {
  console.log(document.name);
}
```

### Downloads return the raw response

Artifact methods hand back the native `Response` so you can stream, buffer, or
pipe it as the situation requires:

```ts
const response = await client.documents.download(documentId, "original");
const bytes = new Uint8Array(await response.arrayBuffer());
```

Only the successful body stays unparsed. A failed download still throws
`ApiError` before any `Response` is returned. The canonical artifact names are
`original`, `certificated`, `certificate-page`, `pades`, and `bundle`;
thumbnails and individual page images have their own methods.

### Errors are typed, and only safe requests retry

Every non-2xx response throws `ApiError`, carrying `status`, the parsed `body`,
the requested `path`, and the `method`. Signer access codes appearing in a path
are redacted before the error is constructed.

| Error class | When it is thrown |
| --- | --- |
| `AssinafyError` | Base class for every error the SDK defines |
| `ConfigurationError` | Invalid base URL, credential combination, transport setting, or request argument |
| `ApiError` | Any non-2xx API response |
| `NotImplementedError` | An adapter was asked for an operation its platform does not support |
| `WebhookSignatureError` | A webhook signature failed verification or fell outside the replay window |

Network failures, `408`, `425`, `429`, and selected `5xx` responses are retried
with exponential backoff, honoring a server `Retry-After` when one is present.
Retries apply **only** to `GET`, `HEAD`, and `OPTIONS`. Mutating requests are
never retried, because the API publishes no idempotency-key contract and a
silent retry could create a duplicate signature request. Aborting through
`RequestInit.signal` cancels an in-flight retry wait as well as the request.

Pass `onRateLimit` to observe parsed `X-Rate-Limit-*` metadata as it arrives;
an exception thrown by that observer is swallowed so it can never turn a
successful request into a failed one.

---

## 7. The document-signing lifecycle

With the transport understood, here is the workflow the API is built around. A
document normally moves through these stages:

1. Create or reuse the signer records.
2. Upload a PDF — at most 25 MB and 2,000 pages.
3. Wait for metadata processing when the workflow needs page coordinates.
4. Estimate the assignment cost and confirm the account has the resources.
5. Create the assignment, which starts notification and signing.
6. Track progress by webhook or bounded polling.
7. Download the certificated artifact once the status is `certificated`.

The example below is the complete virtual-signature flow, polling for clarity.
Production workflows should prefer a webhook subscription, covered further
down.

```ts
import { readFile } from "node:fs/promises";
import { AssinafyClient } from "@assinafy/chat-sdk/client";

const client = AssinafyClient.fromEnv();
const accountId = client.accountId;
if (!accountId) throw new Error("ASSINAFY_ACCOUNT_ID is required");
if (!process.env.ASSINAFY_API_KEY && !process.env.ASSINAFY_ACCESS_TOKEN) {
  throw new Error("ASSINAFY_API_KEY or ASSINAFY_ACCESS_TOKEN is required");
}

// 1. Signers are account-scoped records, reusable across documents.
const signer = await client.signers.create(accountId, {
  full_name: "Aline Costa",
  email: "signer@example.test",
});

// 2. Upload. `body` accepts a Blob, ArrayBuffer, or Uint8Array — a Node Buffer
//    is a Uint8Array, so `readFile` output works directly.
const document = await client.documents.upload(accountId, {
  filename: "contract.pdf",
  body: await readFile("contract.pdf"),
  contentType: "application/pdf",
});

// 3. Metadata processing renders page images and assigns page ids.
async function waitForStatus(
  documentId: string,
  accepted: ReadonlySet<string>,
  timeoutMs = 120_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await client.documents.get(documentId);
    if (accepted.has(current.status)) return current;
    if (["failed", "expired", "rejected_by_signer", "rejected_by_user"].includes(current.status)) {
      throw new Error(`Document entered terminal status: ${current.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Timed out waiting for document status");
}

await waitForStatus(document.id, new Set(["metadata_ready"]));

// 4. Price the request before committing to it.
const estimate = await client.assignments.estimateCost(document.id, {
  method: "virtual",
  signers: [{ verification_method: "Email", notification_methods: ["Email"] }],
});
if (estimate.has_sufficient_resources === false) {
  throw new Error(estimate.message ?? estimate.blocking_reason ?? "Insufficient resources");
}

// 5. Creating the assignment sends the notifications.
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
});

console.log(`Assignment created: ${assignment.id}`);

// 6 and 7. The signer completes the link Assinafy delivered; resume from a
// webhook in production, or keep the bounded polling shown here.
await waitForStatus(document.id, new Set(["certificated"]));
const certificated = await client.documents.download(document.id, "certificated");
const bytes = new Uint8Array(await certificated.arrayBuffer());
console.log(`Downloaded ${bytes.byteLength} certificated bytes`);
```

Signers sharing a `step` sign in parallel; a step activates only once every
signer in the previous one has signed. `verification_method` selects how the
signer proves identity — `Email`, `Whatsapp`, or `DigitalCertificate` — and
`notification_methods` selects the channels used to reach them.

### Collect assignments place fields on the page

`method: "virtual"` asks a signer to sign the document as-is. `method:
"collect"` additionally asks them to fill named fields, and therefore needs the
document to reach `metadata_ready` first: each placement references a real page
id and is positioned in pixels on Assinafy's 150-DPI page image, measured from
the upper-left corner.

```ts
const ready = await client.documents.get(document.id);
const page = ready.pages![0]!;

await client.assignments.create(document.id, {
  method: "collect",
  signers: [{ id: signer.id }],
  entries: [
    {
      page_id: page.id,
      fields: [
        {
          signer_id: signer.id,
          field_id: fieldDefinition.id,
          display_settings: { left: 69, top: 282, width: 421, height: 40, fontSize: 12 },
        },
      ],
    },
  ],
});
```

Field definitions themselves are account-scoped and reusable — create them with
`client.fields.create()`, list the available types with
`client.fields.listTypes()`, and validate values before submission with
`client.fields.validate()` or `validateMultiple()`.

### Templates skip the upload

When the same document is sent repeatedly, a template turns the whole of steps
2 through 5 into a single call. Templates define roles rather than signers, and
instantiating one binds a concrete signer to each role:

```ts
const { data: templates } = await client.templates.list(accountId, { perPage: 10 });
const template = await client.templates.get(accountId, templates[0]!.id);
const role = template.roles![0]!;

const created = await client.templates.instantiate(accountId, template.id, {
  name: "nda-acme.pdf",
  signers: [{ role_id: role.id, id: signer.id }],
});
```

`client.templates.estimateCost()` prices an instantiation the same way
`assignments.estimateCost()` prices a direct assignment.

### Tags organize documents

Tags are colored account-level labels attached to documents by id:

```ts
const tag = await client.tags.create(accountId, { name: "Legal", color: "#2563EB" });

await client.tags.setForDocument(accountId, document.id, [tag.id]);   // replaces
await client.tags.addToDocument(accountId, document.id, [tag.id]);    // appends
await client.tags.removeFromDocument(accountId, document.id, tag.id); // detaches one
```

`documents.list()` accepts a `tags` filter and returns only documents carrying
**all** of the listed tags.

### Webhooks replace polling

An account has one webhook subscription. Point it at your endpoint, list the
events you care about, and Assinafy delivers each one:

```ts
await client.webhooks.updateSubscription(accountId, {
  events: ["document_ready", "signer_signed_document", "document_processing_failed"],
  is_active: true,
  url: "https://example.com/hooks/assinafy",
  email: "ops@example.test",
});
```

`client.webhooks.listEventTypes()` enumerates every supported event with its
description. When a delivery fails, `listDispatches()` shows the attempt history
with the HTTP status and response body, and `retryDispatch()` replays one.
`inactivate()` stops delivery while preserving the URL and event selection —
the API exposes no true delete for a subscription.

Verify each inbound delivery before trusting it. The SDK ships the HMAC
primitives so an adapter only writes its platform's header parsing:

```ts
import { verifyWebhookSignature } from "@assinafy/chat-sdk/adapters";

verifyWebhookSignature({
  secret: process.env.WEBHOOK_SECRET!,
  body: rawRequestBody,       // the raw bytes, before JSON parsing
  signature: request.headers["x-signature"] as string,
  timestamp: request.headers["x-timestamp"] as string, // enables replay protection
});
```

It throws `WebhookSignatureError` on a mismatch, a malformed signature, a
missing secret, or a timestamp outside the tolerance window — five minutes by
default. `isValidWebhookSignature()` is the same check returning a boolean. The
signature must be computed over the raw body: parsing and re-serializing the
JSON first will change the bytes and fail verification.

### The signer-facing flow

Everything above is the account holder's side. Signers themselves authenticate
with a `signer-access-code` that Assinafy delivered out of band, and never with
an API key — so those calls go through an unauthenticated client:

```ts
const publicClient = new AssinafyClient({ baseUrl: "https://sandbox.assinafy.com.br/v1" });

const self = await publicClient.signature.self(accessCode);
await publicClient.signature.verify(accessCode, otpFromEmail);
const context = await publicClient.signature.signContext(accessCode);
await publicClient.signature.sign(documentId, assignmentId, accessCode, entries);
```

`SignatureResource` covers the whole flow: fetching the signer's own record,
accepting terms, verifying the one-time code, uploading a signature or initials
image, retrieving the signing context, listing and searching the signer's
documents, downloading artifacts, and signing or declining — one document at a
time or several at once. Digital-certificate signers must confirm their data and
accept the terms before requesting signing context, which
`client.signers.confirmDataForDocument()` does in a single call.

Documents can also be released without a code at all:
`client.documents.publicGet()` fetches a public summary,
`client.documents.verify()` validates a signature hash with no credential, and
`client.documents.sendPublicToken()` asks Assinafy to deliver a fresh access
token:

```ts
await publicClient.documents.sendPublicToken(documentId, { email: "signer@example.test" });
```

That request is sent exactly once and never retried, because it can dispatch an
email or WhatsApp message.

### Treat access codes as credentials

A signer access code, and any URL containing one, is a bearer credential for
that document. Keep both out of logs, analytics, exception messages, source
control, and any client-visible storage the signing UI does not require. Send
them only over HTTPS, avoid putting them in third-party redirect URLs, set a
restrictive `Referrer-Policy` such as `no-referrer` on signer-facing pages, and
redact query strings before recording request paths. The SDK redacts them from
`ApiError.path` automatically, but only your application controls the rest.
Wherever possible, let Assinafy deliver signing links through the configured
notification channels rather than handling the codes yourself.

---

## 8. Building a chat workflow

The chat layer wraps the same client in a conversational shape. Four pieces fit
together:

- **`Chat`** receives normalized events and routes them to your handlers.
- **An adapter** connects `Chat` to a messaging platform and normalizes its
  payloads. The package ships an in-memory adapter; production adapters
  implement the same `ChatAdapter` contract.
- **`Thread`** is the per-conversation handle every handler receives.
- **A state backend** stores thread subscriptions and per-thread key/value
  data. The in-memory implementation is included; Redis or Postgres backends
  implement the same `ChatState` contract.

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

await memory.receive({ text: "/status doc_01J00000000000000000000000", isMention: true });
console.log(memory.lastSent);
```

An inbound message is offered to the registered handlers in a fixed priority
order, and the first category that matches wins: slash commands
(`onCommand`), then regex matches (`onNewMessage`), then follow-ups on a
subscribed thread (`onSubscribedMessage`), then explicit mentions
(`onNewMention`), and finally the catch-all (`onFallback`). Button clicks and
similar events go to `onAction` instead.

That third rule is what makes multi-turn conversations work. Calling
`thread.subscribe()` marks a thread as one the bot is following, so subsequent
messages in it reach `onSubscribedMessage` without needing another mention.
`thread.get()`, `set()`, and `delete()` store per-thread data — the document a
user is currently working on, for instance — through the same state backend.

### Cards render everywhere

A card is a plain JSON structure, not platform markup, so the same message can
be delivered to a chat platform that renders rich blocks, an email that needs
HTML, and a CLI that needs plain text. Fifteen element types are available:
`card`, `text`, `heading`, `divider`, `section`, `fields`, `link-button`,
`button`, `actions`, `image`, `table`, `select`, `radio-select`,
`document-preview`, and `signer-status`. The last two are Assinafy-specific
conveniences.

```ts
import {
  Card, Heading, Text, Divider, Actions, LinkButton, Button,
  renderText, renderMarkdown, renderHtml,
} from "@assinafy/chat-sdk/cards";

const message = Card({
  title: "Document sent",
  children: [
    Heading(2, "contract.pdf"),
    Text("Sent to signer@example.test for signature."),
    Divider(),
    Actions([
      LinkButton({ label: "Open", url: signingUrl }),
      Button({ id: "remind", label: "Remind", style: "secondary" }),
    ]),
  ],
});

renderText(message);     // SMS, plain email, CLI
renderMarkdown(message); // Markdown-capable chat platforms
renderHtml(message);     // HTML email, web views
```

Builders are exported under both capitalized names (`Card`, `Text`) and
lowercase aliases (`card`, `text`). An adapter that supports native rich
messages can walk the same primitives to emit its own format instead of using
these renderers. The HTML renderer escapes all text and restricts `href` and
`src` to `http`, `https`, `mailto`, and `tel`, so a hostile URL in a document
name cannot become script execution.

---

## 9. Driving the API from an LLM

`createChatTools(client)` returns 36 provider-neutral tool descriptors — the
read and write operations a conversational assistant realistically needs.
Each descriptor carries a `name`, a `description`, a JSON Schema exposed as
both `input_schema` (Anthropic's field name) and `parameters` (OpenAI's), and
an `execute()` that validates its arguments before calling the client.

```ts
import { createChatTools, runTool } from "@assinafy/chat-sdk/ai";

const tools = createChatTools(client, {
  include: ["list_documents", "get_document", "document_activities"],
});

const result = await runTool(tools, "list_documents", { status: "pending_signature" });
```

The `include` and `exclude` options control the surface the model sees, which
is how you keep an assistant read-only. Arguments arriving from a model are
untrusted input, so `execute()` validates them against the schema — types,
enums, bounds, required fields, and `email`, `uri`, and `date-time` formats —
before any request is made. Setting `accountId` on the client, or on
`createChatTools`, lets the model omit it from every call.

The SDK never imports an LLM provider package and never runs the tool loop
itself; your application stays in control of the conversation. The
[`examples/ai-bot.ts`](https://github.com/assinafy/chat-sdk/blob/main/examples/ai-bot.ts)
example shows a complete tool-call loop against Anthropic using nothing but
Node's built-in `fetch`.

---

## 10. Examples

The examples import the repository source directly and are type-checked in CI
by `tsconfig.examples.json`:

- [`examples/basic-bot.ts`](https://github.com/assinafy/chat-sdk/blob/main/examples/basic-bot.ts)
  — an in-memory `/status` bot, the smallest complete wiring.
- [`examples/live-cli.ts`](https://github.com/assinafy/chat-sdk/blob/main/examples/live-cli.ts)
  — a sandbox-backed `/docs` and `/status` REPL that validates credentials
  before starting.
- [`examples/ai-bot.ts`](https://github.com/assinafy/chat-sdk/blob/main/examples/ai-bot.ts)
  — the Anthropic tool-call loop described above.

Run one with the repository's development dependencies installed:

```bash
ASSINAFY_API_KEY=... \
ASSINAFY_ACCOUNT_ID=... \
ASSINAFY_BASE_URL=https://sandbox.assinafy.com.br/v1 \
npx tsx examples/live-cli.ts
```

`examples/ai-bot.ts` additionally reads `ANTHROPIC_API_KEY`, and optionally
`ANTHROPIC_MODEL` to override its `claude-sonnet-5` default.

---

## 11. Development and verification

One command runs everything CI runs — type-checking of the source, tests, and
examples; linting; unit tests with coverage thresholds; the build; and a smoke
test that loads both the ES module and CommonJS output of every entry point and
checks their exports agree:

```bash
npm run verify
```

The live suite is separate because it needs credentials and talks to the
sandbox:

```bash
npm run test:integration
```

It creates and deletes disposable resources — signers, documents, fields, tags,
and a throwaway workspace account — and exercises account CRUD, logo upload,
and webhook mutation. Run it only against a dedicated sandbox account, never
production; the suite refuses any base URL other than the sandbox host.

Two tests are gated behind `ASSINAFY_TEST_NOTIFICATIONS=1` because they cause
Assinafy to send real notifications: template instantiation and the full signing
happy path. Enabling them also requires `ASSINAFY_TEST_EMAIL_PRIMARY` and
`ASSINAFY_TEST_EMAIL_SECONDARY`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ASSINAFY_TEST_NOTIFICATIONS` | `0` | Set to `1` only for a run that may send sandbox notifications |
| `ASSINAFY_TEST_EMAIL_PRIMARY` | none | First notification recipient; required only when notifications are enabled |
| `ASSINAFY_TEST_EMAIL_SECONDARY` | none | Second notification recipient; same condition |

Unit tests and example type-checking need no network access and no credentials.

CI runs the unit job on every push and pull request. The credentialed
integration job runs only for trusted `main` pushes and manual dispatches from
`main`, so a pull request from a fork can never reach the sandbox secrets.
Release tags additionally re-run the full verification and the live suite before
publishing to npm with OIDC provenance and to GitHub Packages, from an artifact
built once and verified before either publish.

---

## License

MIT — see [LICENSE](./LICENSE).
