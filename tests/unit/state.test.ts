import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStateAdapter } from "../../src/state/memory.js";

describe("MemoryStateAdapter", () => {
  let state: MemoryStateAdapter;
  beforeEach(() => {
    state = new MemoryStateAdapter();
  });

  it("tracks subscriptions per adapter", async () => {
    await state.subscribe("t1", "slack");
    expect(await state.isSubscribed("t1", "slack")).toBe(true);
    expect(await state.isSubscribed("t1", "memory")).toBe(false);
  });

  it("wildcard subscription matches every adapter", async () => {
    await state.subscribe("t2");
    expect(await state.isSubscribed("t2", "slack")).toBe(true);
    expect(await state.isSubscribed("t2", "memory")).toBe(true);
  });

  it("unsubscribe removes the entry", async () => {
    await state.subscribe("t3", "memory");
    await state.unsubscribe("t3", "memory");
    expect(await state.isSubscribed("t3", "memory")).toBe(false);
  });

  it("KV: round-trip and delete", async () => {
    await state.setThreadValue("t4", "current_doc", { id: "doc-1" });
    expect(await state.getThreadValue("t4", "current_doc")).toEqual({ id: "doc-1" });
    await state.deleteThreadValue("t4", "current_doc");
    expect(await state.getThreadValue("t4", "current_doc")).toBeUndefined();
  });

  it("listSubscriptions filters by adapter", async () => {
    await state.subscribe("a", "slack");
    await state.subscribe("b", "memory");
    await state.subscribe("c");
    const slack = await state.listSubscriptions("slack");
    expect(slack.map((s) => s.threadId).sort()).toEqual(["a", "c"]);
  });

  it("exports InMemoryState as a deprecated alias", async () => {
    const { InMemoryState } = await import("../../src/state/memory.js");
    expect(InMemoryState).toBe(MemoryStateAdapter);
  });
});
