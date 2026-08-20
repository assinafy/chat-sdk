import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryAdapter, MemoryAdapter, BaseAdapter } from "../../src/adapters/index.js";
import { NotImplementedError } from "../../src/client/errors.js";

describe("createMemoryAdapter (factory)", () => {
  let adapter: MemoryAdapter;
  beforeEach(() => {
    adapter = createMemoryAdapter();
  });

  it("returns a MemoryAdapter instance with name=memory", () => {
    expect(adapter).toBeInstanceOf(MemoryAdapter);
    expect(adapter.name).toBe("memory");
  });

  it("accepts a name override", () => {
    expect(createMemoryAdapter({ name: "test-channel" }).name).toBe("test-channel");
  });

  it("postMessage(threadId, message) records to the outbox", async () => {
    const out = await adapter.postMessage("t1", { text: "hi" });
    expect(out.threadId).toBe("t1");
    expect(adapter.outbox).toHaveLength(1);
    expect(adapter.outbox[0]!.text).toBe("hi");
    expect(adapter.outbox[0]!.threadId).toBe("t1");
  });

  it("openDM is idempotent per recipient", async () => {
    const a = await adapter.openDM("alice@example.com");
    const b = await adapter.openDM("alice@example.com");
    const c = await adapter.openDM("bob@example.com");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("fires onMessage listeners with the new author/from aliases", async () => {
    const received: Array<{ text: string; isMention: boolean; from: string; author: string }> = [];
    adapter.onMessage((m) => {
      received.push({
        text: m.text,
        isMention: m.isMention,
        // The SDK always populates the deprecated `from` alias; assert it here.
        from: m.from!.id,
        author: m.author.id,
      });
    });
    await adapter.receive({ text: "ping", author: { id: "u-2", displayName: "Bob" } });
    expect(received[0]).toEqual({ text: "ping", isMention: true, from: "u-2", author: "u-2" });
  });

  it("editMessage(threadId, messageId, message) rewrites the outbox entry", async () => {
    const sent = await adapter.postMessage("t", { text: "v1" });
    await adapter.editMessage("t", sent.id, { text: "v2" });
    expect(adapter.outbox[0]!.text).toBe("v2");
  });

  it("deleteMessage(threadId, messageId) removes the entry", async () => {
    const sent = await adapter.postMessage("t", { text: "v1" });
    await adapter.deleteMessage("t", sent.id);
    expect(adapter.outbox).toHaveLength(0);
  });

  it("supports listener cleanup, actions, no-op indicators, counts, and reset", async () => {
    const messages: string[] = [];
    const actions: string[] = [];
    const stopMessages = adapter.onMessage((message) => {
      messages.push(message.text);
    });
    const stopActions = adapter.onAction((action) => {
      actions.push(action.actionId);
    });

    await adapter.receive({ text: "first" });
    await adapter.receiveAction({ threadId: "t1", actionId: "approve" });
    stopMessages();
    stopActions();
    await adapter.receive({ text: "ignored" });
    await adapter.receiveAction({ threadId: "t1", actionId: "ignored" });
    await adapter.addReaction();
    await adapter.removeReaction();
    await adapter.startTyping();

    expect(messages).toEqual(["first"]);
    expect(actions).toEqual(["approve"]);
    await adapter.postMessage("t1", { text: "sent" });
    expect(adapter.sentCount).toBe(1);
    adapter.reset();
    expect(adapter.sentCount).toBe(0);
  });

  it("InMemoryAdapter alias still resolves to MemoryAdapter", async () => {
    const { InMemoryAdapter } = await import("../../src/adapters/memory.js");
    expect(InMemoryAdapter).toBe(MemoryAdapter);
  });
});

describe("BaseAdapter defaults", () => {
  class Stub extends BaseAdapter {
    readonly name = "stub";
    async postMessage() {
      return { id: "x", threadId: "t" };
    }
    async openDM() {
      return "t";
    }
  }

  it("throws NotImplementedError for every optional op", async () => {
    const stub = new Stub();
    await expect(stub.editMessage("t", "x", { text: "y" })).rejects.toBeInstanceOf(NotImplementedError);
    await expect(stub.deleteMessage("t", "x")).rejects.toBeInstanceOf(NotImplementedError);
    await expect(stub.addReaction("t", "x", ":+1:")).rejects.toBeInstanceOf(NotImplementedError);
    await expect(stub.removeReaction("t", "x", ":+1:")).rejects.toBeInstanceOf(NotImplementedError);
    await expect(stub.startTyping("t")).rejects.toBeInstanceOf(NotImplementedError);
  });
});
