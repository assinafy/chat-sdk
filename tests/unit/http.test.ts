import { describe, it, expect, vi } from "vitest";
import { HttpClient, withQuery } from "../../src/client/http.js";
import { ApiError, ConfigurationError } from "../../src/client/errors.js";

function mkResponse(body: unknown, init: ResponseInit & { headers?: Record<string, string> } = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    headers,
  });
}

describe("HttpClient", () => {
  it("unwraps the envelope on GET", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse({ status: 200, message: "", data: { id: "x" } }));
    const http = new HttpClient({ baseUrl: "https://api", auth: { kind: "apiKey", apiKey: "k" }, fetch: fetchImpl });
    const data = await http.get<{ id: string }>("/things/x");
    expect(data).toEqual({ id: "x" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, init] = fetchImpl.mock.calls[0]!;
    const headers = new Headers(init.headers);
    expect(headers.get("X-Api-Key")).toBe("k");
  });

  it("unwraps successful envelopes that omit data", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 200, message: "sent" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const http = new HttpClient({
      baseUrl: "https://api",
      auth: { kind: "none" },
      fetch: fetchImpl,
    });

    await expect(http.put<void>("/send-token", {})).resolves.toBeUndefined();
  });

  it("attaches bearer token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse({ status: 200, message: "", data: null }));
    const http = new HttpClient({
      baseUrl: "https://api",
      auth: { kind: "bearer", token: "tok" },
      fetch: fetchImpl,
    });
    await http.get("/anything");
    const [, init] = fetchImpl.mock.calls[0]!;
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer tok");
  });

  it("throws ApiError on non-2xx, exposing status + body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mkResponse({ status: 422, message: "bad input", data: { field: "email" } }, { status: 422 }),
    );
    const http = new HttpClient({
      baseUrl: "https://api",
      auth: { kind: "apiKey", apiKey: "k" },
      fetch: fetchImpl,
      maxRetries: 0,
    });
    await expect(http.post("/x", {})).rejects.toMatchObject({
      name: "ApiError",
      status: 422,
      path: "/x",
    });
  });

  it("surfaces pagination metadata", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mkResponse(
        { status: 200, message: "", data: [{ id: 1 }, { id: 2 }] },
        {
          headers: {
            "x-pagination-current-page": "1",
            "x-pagination-page-count": "5",
            "x-pagination-per-page": "2",
            "x-pagination-total-count": "10",
          },
        },
      ),
    );
    const http = new HttpClient({
      baseUrl: "https://api",
      auth: { kind: "apiKey", apiKey: "k" },
      fetch: fetchImpl,
    });
    const page = await http.getPage<{ id: number }>("/things");
    expect(page.data).toHaveLength(2);
    expect(page.pagination).toEqual({
      currentPage: 1,
      pageCount: 5,
      perPage: 2,
      totalCount: 10,
    });
  });

  it("retries 503 then succeeds", async () => {
    let calls = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1) return mkResponse("oops", { status: 503, headers: { "content-type": "text/plain" } });
      return mkResponse({ status: 200, message: "", data: "ok" });
    });
    const http = new HttpClient({
      baseUrl: "https://api",
      auth: { kind: "apiKey", apiKey: "k" },
      fetch: fetchImpl,
      maxRetries: 2,
      retryBaseDelayMs: 1,
    });
    const data = await http.get<string>("/x");
    expect(data).toBe("ok");
    expect(calls).toBe(2);
  });

  it("never retries a mutating request after an ambiguous server error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse("oops", { status: 503 }));
    const http = new HttpClient({
      baseUrl: "https://api",
      auth: { kind: "apiKey", apiKey: "k" },
      fetch: fetchImpl,
      maxRetries: 2,
      retryBaseDelayMs: 1,
    });

    await expect(http.post("/documents", {})).rejects.toBeInstanceOf(ApiError);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("retries native fetch errors whose network code is nested in cause", async () => {
    const networkError = new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(mkResponse({ status: 200, message: "", data: "ok" }));
    const http = new HttpClient({
      baseUrl: "https://api",
      auth: { kind: "apiKey", apiKey: "k" },
      fetch: fetchImpl,
      retryBaseDelayMs: 1,
    });

    await expect(http.get("/x")).resolves.toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("refuses to attach credentials to a different origin", async () => {
    const fetchImpl = vi.fn();
    const http = new HttpClient({
      baseUrl: "https://api.example/v1",
      auth: { kind: "bearer", token: "secret" },
      fetch: fetchImpl,
    });

    await expect(http.get("https://attacker.example/collect")).rejects.toBeInstanceOf(ConfigurationError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses redirects so custom authentication headers cannot cross origins", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://attacker.example/collect" },
      }),
    );
    const http = new HttpClient({
      baseUrl: "https://api.example/v1",
      auth: { kind: "apiKey", apiKey: "secret" },
      fetch: fetchImpl,
    });

    await expect(http.get("/documents", { redirect: "follow" })).rejects.toBeInstanceOf(ApiError);
    expect(fetchImpl.mock.calls[0]![1].redirect).toBe("manual");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("redacts signer credentials from API errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse("denied", { status: 403 }));
    const http = new HttpClient({
      baseUrl: "https://api",
      auth: { kind: "none" },
      fetch: fetchImpl,
      maxRetries: 0,
    });

    const result = http.get("/documents/x?signer-access-code=top-secret");
    await expect(result).rejects.toMatchObject({
      path: "/documents/x?signer-access-code=[REDACTED]",
    });
    await expect(result).rejects.not.toHaveProperty("message", expect.stringContaining("top-secret"));
  });

  it("applies retries and rate-limit hooks to raw downloads", async () => {
    const onRateLimit = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mkResponse("busy", { status: 503 }))
      .mockResolvedValueOnce(
        mkResponse("file", {
          headers: { "content-type": "application/pdf", "x-rate-limit-limit": "100" },
        }),
      );
    const http = new HttpClient({
      baseUrl: "https://api",
      auth: { kind: "apiKey", apiKey: "k" },
      fetch: fetchImpl,
      retryBaseDelayMs: 1,
      onRateLimit,
    });

    const response = await http.rawRequest("/documents/x/download/original");
    expect(await response.text()).toBe("file");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onRateLimit).toHaveBeenCalledWith({ limit: 100, remaining: 0, resetSeconds: 0 });
  });

  it("refuses construction without auth credentials", () => {
    expect(
      () =>
        new HttpClient({
          baseUrl: "https://api",
          auth: { kind: "apiKey", apiKey: "" },
        }),
    ).toThrow(ConfigurationError);
  });

  it("refuses a relative base URL", () => {
    expect(
      () => new HttpClient({ baseUrl: "/v1", auth: { kind: "none" }, fetch: vi.fn() }),
    ).toThrow(ConfigurationError);
  });
});

describe("withQuery", () => {
  it("appends primitives", () => {
    expect(withQuery("/x", { a: 1, b: "y" })).toBe("/x?a=1&b=y");
  });
  it("repeats array values", () => {
    expect(withQuery("/x", { tag: ["a", "b"] })).toBe("/x?tag=a&tag=b");
  });
  it("skips null and undefined", () => {
    expect(withQuery("/x", { a: undefined, b: null, c: 1 })).toBe("/x?c=1");
  });
  it("preserves existing query strings", () => {
    expect(withQuery("/x?z=1", { a: 2 })).toBe("/x?z=1&a=2");
  });
  it("returns input unchanged when query is empty", () => {
    expect(withQuery("/x", {})).toBe("/x");
    expect(withQuery("/x", undefined)).toBe("/x");
  });
});

describe("ApiError", () => {
  it("includes ApiError in the prototype chain", () => {
    const err = new ApiError({ status: 404, body: {}, path: "/x", method: "GET" });
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(Error);
  });
});
