import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const OPENAPI_URL = "https://api.assinafy.com.br/v1/docs/openapi.json";
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

describe("Assinafy production OpenAPI contract", () => {
  it("maps every published operation in API_COVERAGE.md", async () => {
    const response = await fetch(OPENAPI_URL);
    expect(response.ok).toBe(true);
    const bytes = Buffer.from(await response.arrayBuffer());
    const coverage = await readFile(
      new URL("../../docs/API_COVERAGE.md", import.meta.url),
      "utf8",
    );
    const documentedSha = coverage.match(/^\| SHA-256 \| `([a-f0-9]{64})` \|$/m)?.[1];
    expect(documentedSha).toBeDefined();
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(documentedSha);

    const spec = JSON.parse(bytes.toString("utf8")) as {
      paths?: Record<string, Record<string, unknown>>;
    };
    const published = Object.entries(spec.paths ?? {}).flatMap(([path, item]) =>
      Object.keys(item)
        .filter((method) => HTTP_METHODS.has(method))
        .map((method) => `${method.toUpperCase()} ${path}`),
    );
    const documented = [...coverage.matchAll(/^\| (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \| `([^`]+)` \|/gm)]
      .map((match) => `${match[1]} ${match[2]}`);

    expect(published).toHaveLength(89);
    expect(new Set(documented).size).toBe(documented.length);
    expect(documented.sort()).toEqual(published.sort());
  });
});
