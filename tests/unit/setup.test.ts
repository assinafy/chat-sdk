import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveFetch, loadEnv } from "../setup.js";

const originalBaseUrl = process.env.ASSINAFY_BASE_URL;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (originalBaseUrl === undefined) delete process.env.ASSINAFY_BASE_URL;
  else process.env.ASSINAFY_BASE_URL = originalBaseUrl;
});

describe("live test configuration", () => {
  it("refuses to send sandbox credentials to another origin", () => {
    process.env.ASSINAFY_BASE_URL = "https://example.test/v1";
    expect(() => loadEnv()).toThrow("Live tests require ASSINAFY_BASE_URL");
  });

  it.each([650, 2_000])("spaces concurrent live requests by %i ms without mutation retries", async (intervalMs) => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchImpl);
    const paced = createLiveFetch(intervalMs);
    const init = { method: "POST", body: "request-body" };
    const first = paced("https://example.test/first", init);
    const second = paced("https://example.test/second", init);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(intervalMs - 1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenLastCalledWith("https://example.test/second", init);
    expect((await Promise.all([first, second])).map((response) => response.status)).toEqual([503, 503]);
  });
});
