import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const RESOURCE_NAMES = [
  "accounts",
  "assignments",
  "auth",
  "documents",
  "fields",
  "oauth",
  "signature",
  "signers",
  "tags",
  "templates",
  "users",
  "webhooks",
] as const;

describe("published documentation", () => {
  it("uses reserved example email domains and excludes local engineering notes", async () => {
    for (const path of ["README.md", "README.en.md", "docs/API_REFERENCE.md", "docs/API_COVERAGE.md"]) {
      const document = await readFile(new URL(`../../${path}`, import.meta.url), "utf8");
      for (const match of document.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) {
        expect(match[1]).toMatch(/^example\.(?:test|com)$/);
      }
      expect(document).not.toMatch(/\b(?:audited|audit findings|comparison|comparative|review findings)\b/i);
    }
    const ignored = await readFile(new URL("../../.gitignore", import.meta.url), "utf8");
    expect(ignored.split("\n")).toEqual(expect.arrayContaining(["/AGENTS.md", "/CLAUDE.md"]));
    const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as { files: string[] };
    expect(pkg.files).not.toContain("AGENTS.md");
    expect(pkg.files).not.toContain("CLAUDE.md");
  });

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
          // Only the resource class itself. Module-level helpers below it are
          // indented the same way, so matching the whole file would pick up
          // statements inside them as if they were public methods.
          const classBody = source.slice(source.indexOf("export class")).split(/^\}/m)[0]!;
          return [...classBody.matchAll(/^ {2}(?:async )?\*?([a-z]\w*)\s*\(/gm)]
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
    expect(operationLinks.length).toBeGreaterThanOrEqual(93 * 2);
    expect([...new Set(operationLinks.filter((anchor) => !anchors.has(anchor)))]).toEqual([]);

    const jsonBlocks = [...reference.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => match[1]!);
    expect(jsonBlocks.length).toBeGreaterThan(70);
    for (const json of jsonBlocks) expect(() => JSON.parse(json)).not.toThrow();
  });
});
