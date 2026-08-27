/**
 * In-memory adapter — drives a {@link Chat} bot entirely in process.
 *
 * Created via the {@link createMemoryAdapter} factory.
 *
 * Used by:
 *  - The SDK's own test suite.
 *  - Application integration tests.
 *  - Headless / CLI bots (drive `adapter.receive(...)` and inspect
 *    `adapter.outbox`).
 */

import type { Card, MessageBody } from "../cards/types.js";
import {
  BaseAdapter,
  buildIncomingAction,
  buildIncomingMessage,
  type ChatHandle,
  type Identity,
  type IncomingAction,
  type IncomingMessage,
  type OutgoingMessage,
  type SentMessage,
} from "./base.js";

/** A message the adapter "sent" — captured so tests can inspect it. */
export interface RecordedOutgoing extends OutgoingMessage {
  id: string;
  threadId: string;
  sentAt: Date;
}

/** Options accepted by {@link createMemoryAdapter}. */
export interface MemoryAdapterConfig {
  /**
   * Stable name for this adapter instance. Defaults to `"memory"`. Override
   * when running multiple memory adapters under the same Chat (rare).
   */
  name?: string;
}

let nextId = 1;
const newId = (prefix: string) => `${prefix}-${String(nextId++).padStart(6, "0")}`;

/**
 * Concrete adapter. Most consumers should use {@link createMemoryAdapter}
 * instead of touching this class directly, but it's exported for advanced
 * use-cases (e.g. subclassing in custom test harnesses).
 */
export class MemoryAdapter extends BaseAdapter {
  override readonly name: string;

  /** Captured outbox of everything the bot has tried to send. */
  readonly outbox: RecordedOutgoing[] = [];

  private readonly dmThreads = new Map<string, string>();
  private messageListeners: Array<(msg: IncomingMessage) => void | Promise<void>> = [];
  private actionListeners: Array<(action: IncomingAction) => void | Promise<void>> = [];

  constructor(config: MemoryAdapterConfig = {}) {
    super();
    this.name = config.name ?? "memory";
  }

  override async initialize(chat: ChatHandle): Promise<void> {
    this.chat = chat;
    // Internal listeners that fan inbound traffic into the Chat dispatcher.
    this.onMessage((msg) => chat.processMessage(this, msg));
    this.onAction((action) => chat.processAction(this, action));
  }

  override async postMessage(threadId: string, message: OutgoingMessage): Promise<SentMessage> {
    const id = newId("msg");
    this.outbox.push({ ...message, id, threadId, sentAt: new Date() });
    return { id, threadId };
  }

  override async openDM(recipient: string): Promise<string> {
    let existing = this.dmThreads.get(recipient);
    if (!existing) {
      existing = newId("thread");
      this.dmThreads.set(recipient, existing);
    }
    return existing;
  }

  override async editMessage(threadId: string, messageId: string, message: OutgoingMessage): Promise<void> {
    const idx = this.outbox.findIndex((m) => m.id === messageId && m.threadId === threadId);
    if (idx === -1) throw new Error(`memory adapter: cannot edit unknown message ${messageId}`);
    const target = this.outbox[idx]!;
    this.outbox[idx] = {
      ...target,
      text: message.text,
      card: message.card,
      fallbackText: message.fallbackText,
      attachments: message.attachments,
    };
  }

  override async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const idx = this.outbox.findIndex((m) => m.id === messageId && m.threadId === threadId);
    if (idx !== -1) this.outbox.splice(idx, 1);
  }

  override async addReaction(): Promise<void> {
    // No-op in memory; tests can ignore reactions.
  }
  override async removeReaction(): Promise<void> {
    // No-op in memory.
  }
  override async startTyping(): Promise<void> {
    // No-op in memory.
  }

  /** Register a listener for inbound messages. Returns an unsubscribe fn. */
  onMessage(handler: (msg: IncomingMessage) => void | Promise<void>): () => void {
    this.messageListeners.push(handler);
    return () => {
      this.messageListeners = this.messageListeners.filter((h) => h !== handler);
    };
  }

  /** Register a listener for inbound actions/commands. Returns an unsubscribe fn. */
  onAction(handler: (action: IncomingAction) => void | Promise<void>): () => void {
    this.actionListeners.push(handler);
    return () => {
      this.actionListeners = this.actionListeners.filter((h) => h !== handler);
    };
  }

  /** Simulate an inbound message. Returns the synthesized {@link IncomingMessage}. */
  async receive(input: {
    text: string;
    author?: Partial<Identity>;
    /** @deprecated Use {@link author}. */
    from?: Partial<Identity>;
    threadId?: string;
    isMention?: boolean;
    /** @deprecated Use {@link isMention}. */
    mentionsBot?: boolean;
    attachments?: IncomingMessage["attachments"];
  }): Promise<IncomingMessage> {
    const partial = input.author ?? input.from ?? {};
    const author: Identity = {
      id: partial.id ?? "user-1",
      displayName: partial.displayName ?? "Test User",
      email: partial.email,
      metadata: partial.metadata,
    };
    const msg = buildIncomingMessage({
      id: newId("msg"),
      threadId: input.threadId ?? newId("thread"),
      text: input.text,
      author,
      isMention: input.isMention ?? input.mentionsBot ?? true,
      attachments: input.attachments,
      raw: input,
    });
    for (const handler of this.messageListeners) await handler(msg);
    return msg;
  }

  /** Simulate a button click / slash command. */
  async receiveAction(input: {
    actionId: string;
    threadId: string;
    value?: string;
    author?: Partial<Identity>;
    from?: Partial<Identity>;
  }): Promise<IncomingAction> {
    const partial = input.author ?? input.from ?? {};
    const author: Identity = {
      id: partial.id ?? "user-1",
      displayName: partial.displayName ?? "Test User",
      email: partial.email,
    };
    const action = buildIncomingAction({
      id: newId("action"),
      threadId: input.threadId,
      actionId: input.actionId,
      value: input.value,
      author,
      raw: input,
    });
    for (const handler of this.actionListeners) await handler(action);
    return action;
  }

  /** Total number of messages sent so far. */
  get sentCount(): number {
    return this.outbox.length;
  }

  /** Most recently sent message (or undefined). */
  get lastSent(): RecordedOutgoing | undefined {
    return this.outbox[this.outbox.length - 1];
  }

  /** Reset captured state. Useful between tests. */
  reset(): void {
    this.outbox.length = 0;
    this.dmThreads.clear();
  }
}

/**
 * Factory for an in-memory adapter:
 *
 * ```ts
 * import { Chat, createMemoryAdapter, MemoryStateAdapter } from "@assinafy/chat-sdk";
 *
 * const memory = createMemoryAdapter();
 * const chat = new Chat({
 *   userName: "bot",
 *   adapters: { memory },
 *   state: new MemoryStateAdapter(),
 * });
 * ```
 */
export function createMemoryAdapter(config: MemoryAdapterConfig = {}): MemoryAdapter {
  return new MemoryAdapter(config);
}

/** @deprecated Use {@link MemoryAdapter}. */
export const InMemoryAdapter = MemoryAdapter;

// Re-exported for ergonomic builder typing in callers (matches MessageBody).
export type { Card, MessageBody };
