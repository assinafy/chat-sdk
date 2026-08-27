import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const RESOURCE_NAMES = [
  "accounts",
  "assignments",
  "auth",
  "documents",
  "fields",
  "signature",
  "signers",
  "tags",
  "templates",
  "users",
  "webhooks",
] as const;

describe("published documentation", () => {
  it("covers every resource method, operation link, and JSON payload", async () => {
    const reference = await readFile(new URL("../../docs/API_REFERENCE.md", import.meta.url), "utf8");
    const coverage = await readFile(new URL("../../docs/API_COVERAGE.md", import.meta.url), "utf8");

    const sourceMethods = [...new Set((
      await Promise.all(
        RESOURCE_NAMES.map(async (resource) => {
          const source = await readFile(
            new URL(`../../src/client/${resource}.ts`, import.meta.url),
            "utf8",
          );
          return [...source.matchAll(/^ {2}(?:async )?\*?([a-z]\w*)\s*\(/gm)]
            .map((match) => match[1]!)
            .filter((method) => method !== "constructor")
            .map((method) => `${resource}.${method}`);
        }),
      )
    ).flat())];
    const documentedMethods = [...reference.matchAll(/<a id="[^"]+"><\/a>`([a-z]+\.[A-Za-z0-9]+)\(/g)]
      .map((match) => match[1]!);
    expect(documentedMethods.sort()).toEqual(sourceMethods.sort());

    const anchors = new Set([...reference.matchAll(/<a id="([^"]+)"><\/a>/g)].map((match) => match[1]!));
    for (const heading of reference.matchAll(/^#{1,6} (.+)$/gm)) {
      anchors.add(
        heading[1]!
          .toLowerCase()
          .replace(/[^a-z0-9 -]/g, "")
          .trim()
          .replace(/ +/g, "-"),
      );
    }
    const operationLinks = [...coverage.matchAll(/API_REFERENCE\.md#([a-z0-9-]+)/g)].map((match) => match[1]!);
    expect(operationLinks.length).toBeGreaterThanOrEqual(89 * 2);
    expect([...new Set(operationLinks.filter((anchor) => !anchors.has(anchor)))]).toEqual([]);

    const jsonBlocks = [...reference.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => match[1]!);
    expect(jsonBlocks.length).toBeGreaterThan(70);
    for (const json of jsonBlocks) expect(() => JSON.parse(json)).not.toThrow();
  });
});
