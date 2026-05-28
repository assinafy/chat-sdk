import { describe, it, expect, beforeEach } from "vitest";
import { Chat } from "../../src/chat.js";
import { createMemoryAdapter, type MemoryAdapter } from "../../src/adapters/index.js";
import { MemoryStateAdapter } from "../../src/state/memory.js";
import { Card, Text } from "../../src/cards/index.js";

describe("Chat", () => {
  let adapter: MemoryAdapter;
  let chat: Chat;
  beforeEach(async () => {
    adapter = createMemoryAdapter();
    chat = new Chat({
      userName: "Test Bot",
      adapters: { memory: adapter },
      state: new MemoryStateAdapter(),
    });
    // The Chat constructor schedules adapter.initialize() asynchronously
    // (microtask). Wait for the next tick so adapters are wired before we
    // start firing events.
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  it("routes mentions to onNewMention", async () => {
    const seen: string[] = [];
    chat.onNewMention(async (thread, msg) => {
      seen.push(msg.text);
      await thread.post("ack");
    });
    await adapter.receive({ text: "hello bot", isMention: true });
    expect(seen).toEqual(["hello bot"]);
    expect(adapter.lastSent?.text).toBe("ack");
  });

  it("routes follow-ups to onSubscribedMessage when thread is subscribed", async () => {
    const events: string[] = [];
    chat.onNewMention(async (thread) => {
      await thread.subscribe();
      events.push("mention");
    });
    chat.onSubscribedMessage(async (_, msg) => {
      events.push(`follow:${msg.text}`);
    });
    const m1 = await adapter.receive({ text: "@bot start", isMention: true });
    await adapter.receive({ text: "second", isMention: false, threadId: m1.threadId });
    expect(events).toEqual(["mention", "follow:second"]);
  });

  it("matches /command syntax via onCommand", async () => {
    const args: string[] = [];
    chat.onCommand("status", async (_, msg) => {
      args.push(msg.text);
    });
    await adapter.receive({ text: "/status doc-1" });
    expect(args).toEqual(["/status doc-1"]);
  });

  it("matches arbitrary regexes via onNewMessage", async () => {
    const hits: string[] = [];
    chat.onNewMessage(/hello\s+(\w+)/i, async (_, msg) => {
      hits.push(msg.text);
    });
    await adapter.receive({ text: "Hello WORLD" });
    await adapter.receive({ text: "goodbye world" });
    expect(hits).toEqual(["Hello WORLD"]);
  });

  it("openThread + post(Card(...)) round-trip", async () => {
    const thread = await chat.openThread("alice@example.com");
    await thread.post(Card({ title: "Hi", children: [Text("body")] }));
    expect(adapter.lastSent?.card?.title).toBe("Hi");
  });

  it("post accepts { card, fallbackText }", async () => {
    const thread = await chat.openThread("alice@example.com");
    await thread.post({
      card: Card({ title: "Order", children: [Text("Confirmed")] }),
      fallbackText: "Order confirmed",
    });
    expect(adapter.lastSent?.card?.title).toBe("Order");
    expect(adapter.lastSent?.fallbackText).toBe("Order confirmed");
  });

  it("processAction fires onAction handlers", async () => {
    const seen: string[] = [];
    chat.onAction(async (_, action) => {
      seen.push(action.actionId);
    });
    await adapter.receiveAction({ threadId: "t1", actionId: "approve" });
    expect(seen).toEqual(["approve"]);
  });

  it("falls back to onFallback when nothing else matches", async () => {
    const seen: string[] = [];
    chat.onFallback(async (_, m) => {
      seen.push(m.text);
    });
    await adapter.receive({ text: "untargeted", isMention: false });
    expect(seen).toEqual(["untargeted"]);
  });

  it("disconnect() runs adapter.disconnect on adapters that implement it", async () => {
    let disconnected = false;
    const a = createMemoryAdapter({ name: "m2" });
    (a as unknown as { disconnect: () => Promise<void> }).disconnect = async () => {
      disconnected = true;
    };
    const c = new Chat({
      userName: "x",
      adapters: { m2: a },
      state: new MemoryStateAdapter(),
    });
    await c.disconnect();
    expect(disconnected).toBe(true);
  });
});
