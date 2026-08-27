/**
 * Top-level Chat orchestrator.
 *
 * Applications register handlers and the framework routes events from each
 * adapter to the right handler with a fully-hydrated {@link Thread} in hand.
 * Adapters dispatch their webhook events through {@link Chat.processMessage}
 * and {@link Chat.processAction}.
 *
 * ```ts
 * import { Chat, createMemoryAdapter, MemoryStateAdapter, AssinafyClient } from "@assinafy/chat-sdk";
 *
 * const client = AssinafyClient.fromEnv();
 * const memory = createMemoryAdapter();
 *
 * const chat = new Chat({
 *   userName: "Assinafy Bot",
 *   client,
 *   adapters: { memory },
 *   state: new MemoryStateAdapter(),
 * });
 *
 * chat.onNewMention(async (thread, message) => {
 *   await thread.subscribe();
 *   await thread.post(`Got it: "${message.text}"`);
 * });
 * ```
 */

import type { ChatAdapter, ChatHandle, IncomingAction, IncomingMessage } from "./adapters/base.js";
import type { AssinafyClient } from "./client/index.js";
import type { ChatState } from "./state/base.js";
import { MemoryStateAdapter } from "./state/memory.js";
import { Thread, type PostInput } from "./thread.js";

/** Handler signature for inbound messages. */
export type MessageHandler = (thread: Thread, message: IncomingMessage) => void | Promise<void>;
/** Handler signature for inbound actions / commands. */
export type ActionHandler = (thread: Thread, action: IncomingAction) => void | Promise<void>;

/** Options accepted by {@link Chat}. */
export interface ChatOptions {
  /** Display name for the bot (used by adapters when supported). */
  userName: string;
  /** Adapters keyed by their name. At least one is required. */
  adapters: Record<string, ChatAdapter>;
  /** Pluggable state backend. Defaults to {@link MemoryStateAdapter}. */
  state?: ChatState;
  /**
   * Optional Assinafy API client. Not required for the chat framework itself,
   * but most bots will want one and can read it back as `chat.client`.
   */
  client?: AssinafyClient;
  /**
   * Default adapter name to use when the caller doesn't specify one
   * (e.g. `chat.openThread("user@example.com")`). Defaults to the first
   * adapter passed in.
   */
  defaultAdapter?: string;
}

interface PatternHandler {
  pattern: RegExp;
  handler: MessageHandler;
}

export class Chat implements ChatHandle {
  /** Display name for the bot. */
  readonly userName: string;
  /** All registered adapters by name. */
  readonly adapters: Readonly<Record<string, ChatAdapter>>;
  /** State backend used for subscriptions + per-thread KV. */
  readonly state: ChatState;
  /** Optional Assinafy API client mirrored from options. */
  readonly client?: AssinafyClient;
  /** Name of the default adapter (used by convenience methods). */
  readonly defaultAdapter: string;

  private mentionHandlers: MessageHandler[] = [];
  private subscribedHandlers: MessageHandler[] = [];
  private actionHandlers: ActionHandler[] = [];
  private newMessageHandlers: PatternHandler[] = [];
  private commandHandlers: PatternHandler[] = [];
  private fallbackHandler?: MessageHandler;
  private readonly ready: Promise<void>;

  constructor(options: ChatOptions) {
    const adapterNames = Object.keys(options.adapters);
    if (adapterNames.length === 0) {
      throw new Error("Chat requires at least one adapter");
    }
    this.userName = options.userName;
    this.adapters = Object.freeze({ ...options.adapters });
    this.state = options.state ?? new MemoryStateAdapter();
    this.client = options.client;
    this.defaultAdapter = options.defaultAdapter ?? adapterNames[0]!;
    if (!Object.hasOwn(this.adapters, this.defaultAdapter)) {
      throw new Error(`Chat: no adapter registered under name "${this.defaultAdapter}"`);
    }
    // Kick off adapter initialization. The promise is awaited by every dispatch
    // entry point (and exposed via `whenReady()`) so init errors surface rather
    // than being silently swallowed.
    this.ready = this.initializeAdapters();
    void this.ready.catch(() => undefined);
  }

  /**
   * Resolves once every adapter's `initialize()` has completed; rejects if any
   * adapter failed to initialize. Awaiting this is optional — the dispatch
   * entry points await it internally — but useful for fail-fast startup.
   */
  whenReady(): Promise<void> {
    return this.ready;
  }

  // ---------------------------------------------------------------------------
  // Handler registration
  // ---------------------------------------------------------------------------

  /** Register a handler for messages that mention the bot (or open a new thread). */
  onNewMention(handler: MessageHandler): this {
    this.mentionHandlers.push(handler);
    return this;
  }

  /** Register a handler for follow-up messages on subscribed threads. */
  onSubscribedMessage(handler: MessageHandler): this {
    this.subscribedHandlers.push(handler);
    return this;
  }

  /**
   * Register a regex-based handler that fires for any inbound message whose
   * text matches `pattern`.
   */
  onNewMessage(pattern: RegExp, handler: MessageHandler): this {
    this.newMessageHandlers.push({ pattern, handler });
    return this;
  }

  /** Register a handler for action/button events. */
  onAction(handler: ActionHandler): this {
    this.actionHandlers.push(handler);
    return this;
  }

  /**
   * Register a slash-command-style handler. `name` may be a literal command
   * (e.g. `"sign"` to match `/sign` or `!sign`) or a RegExp.
   */
  onCommand(name: string | RegExp, handler: MessageHandler): this {
    const pattern =
      name instanceof RegExp
        ? name
        : new RegExp(`^\\s*[/!]${escapeRegex(name)}(?:\\s+(.*))?\\s*$`, "i");
    this.commandHandlers.push({ pattern, handler });
    return this;
  }

  /** Catch-all handler that fires when nothing else matched. */
  onFallback(handler: MessageHandler): this {
    this.fallbackHandler = handler;
    return this;
  }

  // ---------------------------------------------------------------------------
  // Thread helpers
  // ---------------------------------------------------------------------------

  /** Open a new thread by DMing `recipient`. Useful for proactive outreach. */
  async openThread(recipient: string, adapterName: string = this.defaultAdapter): Promise<Thread> {
    await this.ready;
    const adapter = this.requireAdapter(adapterName);
    const threadId = await adapter.openDM(recipient);
    return new Thread({ id: threadId, adapter, state: this.state, ready: this.ready });
  }

  /** Construct a thread reference for an existing thread id. */
  thread(adapterName: string, threadId: string): Thread {
    return new Thread({
      id: threadId,
      adapter: this.requireAdapter(adapterName),
      state: this.state,
      ready: this.ready,
    });
  }

  /** Convenience: post directly to a thread without retrieving a Thread first. */
  async post(adapterName: string, threadId: string, body: PostInput): Promise<void> {
    await this.ready;
    await this.thread(adapterName, threadId).post(body);
  }

  // ---------------------------------------------------------------------------
  // Dispatch entry points (called by adapters from their webhook handlers)
  // ---------------------------------------------------------------------------

  /**
   * Adapter entry point: dispatch a normalized inbound message through the
   * registered handler chain. Adapters call it from their webhook handlers
   * right after they verify the request signature.
   */
  async processMessage(adapter: ChatAdapter, message: IncomingMessage): Promise<void> {
    await this.ready;
    const thread = new Thread({
      id: message.threadId,
      adapter,
      state: this.state,
      originatingMessage: message,
      ready: this.ready,
    });

    // Priority order: slash command > regex onNewMessage > subscribed follow-up
    // > explicit mention > fallback.
    for (const { pattern, handler } of this.commandHandlers) {
      if (matches(pattern, message.text)) {
        await handler(thread, message);
        return;
      }
    }

    const newMessageHits = this.newMessageHandlers.filter((h) => matches(h.pattern, message.text));
    if (newMessageHits.length > 0) {
      for (const h of newMessageHits) await h.handler(thread, message);
      return;
    }

    const subscribed = await this.state.isSubscribed(message.threadId, adapter.name);
    if (subscribed && this.subscribedHandlers.length > 0) {
      for (const handler of this.subscribedHandlers) await handler(thread, message);
      return;
    }

    if (message.isMention && this.mentionHandlers.length > 0) {
      for (const handler of this.mentionHandlers) await handler(thread, message);
      return;
    }

    if (this.fallbackHandler) {
      await this.fallbackHandler(thread, message);
    }
  }

  /** Adapter entry point: dispatch a normalized inbound action. */
  async processAction(adapter: ChatAdapter, action: IncomingAction): Promise<void> {
    await this.ready;
    const thread = new Thread({ id: action.threadId, adapter, state: this.state, ready: this.ready });
    for (const handler of this.actionHandlers) await handler(thread, action);
  }

  /**
   * Gracefully disconnect every adapter that supports it. Teardown is isolated
   * per adapter: one failing `disconnect()` does not prevent the others from
   * running. Rejects with the first error afterwards, if any occurred.
   */
  async disconnect(): Promise<void> {
    await this.ready.catch(() => undefined);
    const results = await Promise.allSettled(
      Object.values(this.adapters).map((adapter) =>
        typeof adapter.disconnect === "function" ? adapter.disconnect() : Promise.resolve(),
      ),
    );
    const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failure) throw failure.reason;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async initializeAdapters(): Promise<void> {
    for (const adapter of Object.values(this.adapters)) {
      await adapter.initialize(this);
    }
  }

  private requireAdapter(name: string): ChatAdapter {
    if (!Object.hasOwn(this.adapters, name)) {
      throw new Error(`Chat: no adapter registered under name "${name}"`);
    }
    return this.adapters[name]!;
  }
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Test a caller-supplied RegExp without the statefulness of the `g`/`y` flags:
 * `RegExp.prototype.test` advances `lastIndex` for global/sticky patterns,
 * which would make repeated calls intermittently miss. Resetting first keeps
 * matching deterministic regardless of the flags the caller used.
 */
function matches(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}
