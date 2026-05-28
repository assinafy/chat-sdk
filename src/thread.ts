/**
 * Thread — a handler-facing view over a single conversation on a single
 * adapter. Provided to every handler callback so handlers don't need to
 * juggle adapter references manually.
 */

import type { ChatAdapter, IncomingMessage, OutgoingMessage, SentMessage } from "./adapters/base.js";
import type { Card, MessageBody } from "./cards/types.js";
import type { ChatState } from "./state/base.js";

/** What handlers can `post()` — strings, cards, or the structured body. */
export type PostInput = MessageBody;

/** Public surface of a {@link Thread}. */
export interface ThreadLike {
  readonly id: string;
  readonly adapter: ChatAdapter;
  post(body: PostInput): Promise<SentMessage>;
  subscribe(): Promise<void>;
  unsubscribe(): Promise<void>;
  isSubscribed(): Promise<boolean>;
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

export class Thread implements ThreadLike {
  /** Adapter-assigned thread id. */
  readonly id: string;
  /** Adapter this thread lives on. */
  readonly adapter: ChatAdapter;
  /** The originating message, when the thread was created from one. */
  readonly originatingMessage?: IncomingMessage;

  private readonly state: ChatState;

  constructor(args: {
    id: string;
    adapter: ChatAdapter;
    state: ChatState;
    originatingMessage?: IncomingMessage;
  }) {
    this.id = args.id;
    this.adapter = args.adapter;
    this.state = args.state;
    this.originatingMessage = args.originatingMessage;
  }

  /** Post a reply into this thread. */
  post(body: PostInput): Promise<SentMessage> {
    return this.adapter.postMessage(this.id, normalize(body));
  }

  /** Subscribe this thread so follow-up messages trigger `onSubscribedMessage`. */
  subscribe(): Promise<void> {
    return this.state.subscribe(this.id, this.adapter.name);
  }

  /** Stop receiving follow-up events for this thread. */
  unsubscribe(): Promise<void> {
    return this.state.unsubscribe(this.id, this.adapter.name);
  }

  /** Whether this thread is currently subscribed. */
  isSubscribed(): Promise<boolean> {
    return this.state.isSubscribed(this.id, this.adapter.name);
  }

  /** Read a per-thread KV value. */
  get<T>(key: string): Promise<T | undefined> {
    return this.state.getThreadValue<T>(this.id, key);
  }

  /** Write a per-thread KV value. */
  set<T>(key: string, value: T): Promise<void> {
    return this.state.setThreadValue<T>(this.id, key, value);
  }

  /** Delete a per-thread KV value. */
  delete(key: string): Promise<void> {
    return this.state.deleteThreadValue(this.id, key);
  }
}

function normalize(body: PostInput): OutgoingMessage {
  if (typeof body === "string") return { text: body };
  if ("type" in body && body.type === "card") return { card: body as Card };
  const obj = body as Exclude<MessageBody, string | Card>;
  return {
    text: obj.text,
    card: obj.card,
    fallbackText: obj.fallbackText,
    attachments: obj.attachments,
  };
}
