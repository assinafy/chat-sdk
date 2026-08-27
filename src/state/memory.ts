/**
 * In-memory {@link ChatState} implementation.
 *
 * The primary class is {@link MemoryStateAdapter}. `InMemoryState` is a
 * deprecated alias.
 *
 * Suitable for unit tests, local dev, and single-process deployments. For
 * multi-process deployments, swap in a Redis- or Postgres-backed
 * implementation that satisfies the same {@link ChatState} contract.
 */

import type { ChatState, ThreadSubscription } from "./base.js";

function subscriptionKey(threadId: string, adapter?: string): string {
  return JSON.stringify([adapter ?? null, threadId]);
}

function kvKey(threadId: string, key: string): string {
  return JSON.stringify([threadId, key]);
}

export class MemoryStateAdapter implements ChatState {
  private subscriptions = new Map<string, ThreadSubscription>();
  private kv = new Map<string, unknown>();

  async subscribe(threadId: string, adapter?: string): Promise<void> {
    this.subscriptions.set(subscriptionKey(threadId, adapter), {
      threadId,
      adapter,
      subscribedAt: new Date(),
    });
  }

  async unsubscribe(threadId: string, adapter?: string): Promise<void> {
    this.subscriptions.delete(subscriptionKey(threadId, adapter));
  }

  async isSubscribed(threadId: string, adapter?: string): Promise<boolean> {
    if (this.subscriptions.has(subscriptionKey(threadId, adapter))) return true;
    if (!adapter) return false;
    return this.subscriptions.has(subscriptionKey(threadId, undefined));
  }

  async getThreadValue<T>(threadId: string, key: string): Promise<T | undefined> {
    return this.kv.get(kvKey(threadId, key)) as T | undefined;
  }

  async setThreadValue<T>(threadId: string, key: string, value: T): Promise<void> {
    this.kv.set(kvKey(threadId, key), value);
  }

  async deleteThreadValue(threadId: string, key: string): Promise<void> {
    this.kv.delete(kvKey(threadId, key));
  }

  async listSubscriptions(adapter?: string): Promise<ThreadSubscription[]> {
    const all = [...this.subscriptions.values()];
    if (!adapter) return all;
    return all.filter((s) => s.adapter === adapter || s.adapter === undefined);
  }
}

/** @deprecated Use {@link MemoryStateAdapter}. */
export const InMemoryState = MemoryStateAdapter;
