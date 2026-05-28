/**
 * @assinafy/chat-sdk — top-level public API.
 *
 * The default entrypoint re-exports everything an application needs to wire
 * up a bot:
 *
 * ```ts
 * import {
 *   Chat,
 *   InMemoryAdapter,
 *   InMemoryState,
 *   AssinafyClient,
 *   card,
 *   text,
 *   linkButton,
 * } from "@assinafy/chat-sdk";
 * ```
 *
 * Individual subpaths are also available:
 *  - `@assinafy/chat-sdk/client` — just the API client.
 *  - `@assinafy/chat-sdk/cards` — just the card primitives + renderers.
 *  - `@assinafy/chat-sdk/adapters` — adapter base classes + memory adapter.
 *  - `@assinafy/chat-sdk/state` — state interface + in-memory implementation.
 *  - `@assinafy/chat-sdk/ai` — optional LLM tool-calling helpers.
 */

export * from "./chat.js";
export * from "./thread.js";
export {
  // Adapter primitives
  BaseAdapter,
  unsupported,
  buildIncomingMessage,
  buildIncomingAction,
  type Attachment,
  type ChatAdapter,
  type ChatHandle,
  type Identity,
  type IncomingAction,
  type IncomingMessage,
  type OutgoingMessage,
  type SentMessage,
  // Memory adapter
  MemoryAdapter,
  InMemoryAdapter,
  createMemoryAdapter,
  type MemoryAdapterConfig,
  type RecordedOutgoing,
  // Webhook helpers
  verifyWebhookSignature,
  isValidWebhookSignature,
  type VerifyWebhookSignatureOptions,
} from "./adapters/index.js";
export {
  MemoryStateAdapter,
  InMemoryState,
  type ChatState,
  type ThreadSubscription,
} from "./state/index.js";
export * from "./cards/index.js";
export {
  AssinafyClient,
  type AssinafyClientOptions,
  ApiError,
  AssinafyError,
  ConfigurationError,
  NotImplementedError,
  WebhookSignatureError,
  HttpClient,
  withQuery,
  type AuthStrategy,
  type HttpClientOptions,
  type ResponseWithMeta,
  AuthResource,
  SignersResource,
  DocumentsResource,
  FieldsResource,
  TagsResource,
  TemplatesResource,
  AssignmentsResource,
  SignatureResource,
  WebhooksResource,
  type ListTemplatesQuery,
  type SignatureType,
} from "./client/index.js";
export type * from "./client/types.js";
