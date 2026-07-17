/**
 * Adapter interface — connects a {@link Chat} bot to a concrete messaging
 * platform (in-memory test harness, email, team chat, WhatsApp, …).
 *
 *  - Adapters are built with a `createXxxAdapter(config)` factory (see
 *    {@link createMemoryAdapter} for the canonical example).
 *  - `initialize(chat)` is called once when a {@link Chat} attaches the
 *    adapter, so the adapter can store a reference and dispatch events back
 *    via `chat.processMessage()` / `chat.processAction()`.
 *  - Optional operations that don't apply to a platform throw
 *    {@link NotImplementedError} via {@link unsupported}.
 */

import { NotImplementedError } from "../client/errors.js";
import type { Card } from "../cards/types.js";

/** Identity of a participant in a conversation. Adapter-specific. */
export interface Identity {
  /** The adapter's own opaque user id. */
  id: string;
  /** A human-friendly display name, when known. */
  displayName?: string;
  /** Email address, when known. */
  email?: string;
  /** Free-form metadata an adapter can stash here. */
  metadata?: Record<string, unknown>;
}

/**
 * Normalized attachment shape. Field names are camelCase across the SDK.
 *
 * Adapters that surface platform-specific snake_case fields (e.g. Resend's
 * `content_type`) should also preserve the raw payload on
 * {@link IncomingMessage.raw} so handlers can drop down when needed.
 */
export interface Attachment {
  filename: string;
  contentType: string;
  url: string;
  /** Optional size in bytes. */
  size?: number;
}

/** A single inbound message from the platform. */
export interface IncomingMessage {
  /** Adapter-assigned message id (idempotency key). */
  id: string;
  /** Thread id this message belongs to (adapter-specific). */
  threadId: string;
  /** Raw text content. May be empty if the message is purely attachments. */
  text: string;
  /**
   * Who sent it. The SDK exposes both `author` and the older `from` alias
   * pointing at the same object.
   */
  author: Identity;
  /** @deprecated Use {@link author}. Populated by the SDK for backwards compatibility. */
  from?: Identity;
  /** Whether this message explicitly mentions the bot. */
  isMention: boolean;
  /** @deprecated Use {@link isMention}. Kept for backwards compatibility. */
  mentionsBot?: boolean;
  /** Normalized attachments. Adapters preserve the raw payload on {@link raw}. */
  attachments?: Attachment[];
  /** Time the platform reports the message was sent. */
  sentAt: Date;
  /** The opaque raw payload from the underlying platform, for advanced use. */
  raw: unknown;
}

/** An inbound action event (button click, slash command, …). */
export interface IncomingAction {
  id: string;
  threadId: string;
  /** Which `Button.id` (or slash-command name) was invoked. */
  actionId: string;
  /** Optional opaque value, e.g. `Button.value`. */
  value?: string;
  /** Who clicked / typed it. */
  author: Identity;
  /** @deprecated Use {@link author}. Populated by the SDK for backwards compatibility. */
  from?: Identity;
  sentAt: Date;
  raw: unknown;
}

/** Payload an adapter receives via {@link ChatAdapter.postMessage}. */
export interface OutgoingMessage {
  text?: string;
  card?: Card;
  /** Optional fallback to use when the platform can't render the card. */
  fallbackText?: string;
  /** Outbound attachments, when the platform supports them. */
  attachments?: Attachment[];
}

/** What the platform returned after `postMessage` succeeds. */
export interface SentMessage {
  id: string;
  threadId: string;
}

/**
 * Minimal contract every adapter must satisfy. Optional methods are declared
 * here and default-implemented in {@link BaseAdapter} to throw
 * {@link NotImplementedError}, so adapter authors only override what their
 * platform supports.
 */
export interface ChatAdapter {
  /** Stable adapter id, e.g. `"memory"`, `"slack"`, `"resend"`. */
  readonly name: string;

  /**
   * Called once when the adapter is attached to a {@link Chat}. Adapters
   * should stash the reference so they can dispatch inbound webhooks via
   * `chat.processMessage(this, message)` and `chat.processAction(this, action)`.
   */
  initialize(chat: ChatHandle): Promise<void> | void;

  /** Optional cleanup, called by host applications during graceful shutdown. */
  disconnect?(): Promise<void> | void;

  /** Send a message to an existing thread. Returns the platform's message id. */
  postMessage(threadId: string, message: OutgoingMessage): Promise<SentMessage>;

  /** Open a 1:1 conversation with `recipient` and return the resulting thread id. */
  openDM(recipient: string): Promise<string>;

  /** Edit a previously-sent message. Throws if unsupported. */
  editMessage(threadId: string, messageId: string, message: OutgoingMessage): Promise<void>;
  /** Delete a previously-sent message. Throws if unsupported. */
  deleteMessage(threadId: string, messageId: string): Promise<void>;
  /** Add a reaction. Throws if unsupported. */
  addReaction(threadId: string, messageId: string, emoji: string): Promise<void>;
  /** Remove a reaction. Throws if unsupported. */
  removeReaction(threadId: string, messageId: string, emoji: string): Promise<void>;
  /** Send a "typing" indicator. Throws if unsupported. */
  startTyping(threadId: string): Promise<void>;
}

/**
 * Subset of {@link Chat} that adapters need at runtime. Extracting this avoids
 * a circular import between `./adapters/base.ts` and `../chat.ts`.
 */
export interface ChatHandle {
  /** Dispatch a normalized inbound message through the bot's handlers. */
  processMessage(adapter: ChatAdapter, message: IncomingMessage): Promise<void>;
  /** Dispatch a normalized inbound action through the bot's handlers. */
  processAction(adapter: ChatAdapter, action: IncomingAction): Promise<void>;
}

/** Helper that adapters can call to throw a consistent NotImplementedError. */
export function unsupported(adapter: string, operation: string, reason?: string): never {
  throw new NotImplementedError(adapter, operation, reason);
}

/**
 * Convenience base class. Provides `unsupported()` defaults for every
 * optional method so subclasses only override the ones they support, plus a
 * no-op `initialize()` hook that stores the chat handle on `this.chat`.
 */
export abstract class BaseAdapter implements ChatAdapter {
  abstract readonly name: string;
  protected chat?: ChatHandle;

  initialize(chat: ChatHandle): void | Promise<void> {
    this.chat = chat;
  }

  abstract postMessage(threadId: string, message: OutgoingMessage): Promise<SentMessage>;
  abstract openDM(recipient: string): Promise<string>;

  async editMessage(_threadId: string, _messageId: string, _message: OutgoingMessage): Promise<void> {
    unsupported(this.name, "editMessage");
  }
  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    unsupported(this.name, "deleteMessage");
  }
  async addReaction(_threadId: string, _messageId: string, _emoji: string): Promise<void> {
    unsupported(this.name, "addReaction");
  }
  async removeReaction(_threadId: string, _messageId: string, _emoji: string): Promise<void> {
    unsupported(this.name, "removeReaction");
  }
  async startTyping(_threadId: string): Promise<void> {
    unsupported(this.name, "startTyping");
  }
}

/**
 * Construct an {@link IncomingMessage} from a partial input, populating the
 * `author`/`from` and `isMention`/`mentionsBot` aliases automatically.
 * Adapters should use this in their `parseMessage` (or webhook handler) so
 * the shape is consistent across the SDK.
 */
export function buildIncomingMessage(input: {
  id: string;
  threadId: string;
  text: string;
  author: Identity;
  isMention?: boolean;
  attachments?: Attachment[];
  sentAt?: Date;
  raw: unknown;
}): IncomingMessage {
  const isMention = input.isMention ?? false;
  return {
    id: input.id,
    threadId: input.threadId,
    text: input.text,
    author: input.author,
    from: input.author,
    isMention,
    mentionsBot: isMention,
    attachments: input.attachments,
    sentAt: input.sentAt ?? new Date(),
    raw: input.raw,
  };
}

/** Construct an {@link IncomingAction} with the author/from aliases populated. */
export function buildIncomingAction(input: {
  id: string;
  threadId: string;
  actionId: string;
  value?: string;
  author: Identity;
  sentAt?: Date;
  raw: unknown;
}): IncomingAction {
  return {
    id: input.id,
    threadId: input.threadId,
    actionId: input.actionId,
    value: input.value,
    author: input.author,
    from: input.author,
    sentAt: input.sentAt ?? new Date(),
    raw: input.raw,
  };
}
