/**
 * Pluggable state layer.
 *
 * The chat framework keeps a small amount of per-thread metadata:
 *  - which threads the bot is subscribed to (i.e. should react to follow-ups)
 *  - arbitrary key/value pairs scoped to a thread (e.g. the document the user
 *    is currently working on)
 *
 * In production this is typically backed by Redis or Postgres. The SDK ships
 * an in-memory implementation good enough for tests and small deployments.
 */

/** Subscription record used to gate `onSubscribedMessage` handlers. */
export interface ThreadSubscription {
  threadId: string;
  /** Optional adapter name; useful when one bot spans multiple adapters. */
  adapter?: string;
  subscribedAt: Date;
}

/** Contract every state backend must implement. */
export interface ChatState {
  /** Subscribe to a thread so follow-up messages trigger `onSubscribedMessage`. */
  subscribe(threadId: string, adapter?: string): Promise<void>;
  /** Stop receiving follow-up events for a thread. */
  unsubscribe(threadId: string, adapter?: string): Promise<void>;
  /** Check whether a thread is currently subscribed. */
  isSubscribed(threadId: string, adapter?: string): Promise<boolean>;
  /** Per-thread KV: read. Returns undefined when the key has never been set. */
  getThreadValue<T>(threadId: string, key: string): Promise<T | undefined>;
  /** Per-thread KV: write. */
  setThreadValue<T>(threadId: string, key: string, value: T): Promise<void>;
  /** Per-thread KV: delete. */
  deleteThreadValue(threadId: string, key: string): Promise<void>;
  /** List all currently-subscribed threads. */
  listSubscriptions(adapter?: string): Promise<ThreadSubscription[]>;
}
