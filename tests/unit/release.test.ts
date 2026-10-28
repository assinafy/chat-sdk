import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
const notesScript = fileURLToPath(new URL("../../scripts/release-notes.mjs", import.meta.url));
const workflow = readFileSync(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8");

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "assinafy-release-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function releaseNotes(changelog: string, tag = "v2.6.0") {
  const cwd = fixture();
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ version: "2.6.0" }));
  writeFileSync(join(cwd, "CHANGELOG.md"), changelog);
  return spawnSync(process.execPath, [notesScript, tag], { cwd, encoding: "utf8" });
}

describe("release notes", () => {
  it.each(["\n", "\r\n"])("extracts only the matching version with %j line endings", (newline) => {
    const result = releaseNotes([
      "# Changelog", "", "## [Unreleased]", "- Future change.", "",
      "## [2.6.0] - 2026-10-28", "", "### Added", "",
      "- Contract lifecycle management through `client.contracts`.",
      "  Includes renewal and termination.", "", "### Fixed", "", "- Literal $(text).", "",
      "## [2.5.1] - 2026-10-19", "- Older change.",
    ].join(newline));
    expect(result.status).toBe(0);
    expect(result.stdout.replaceAll("\r\n", "\n")).toBe(
      "### Added\n\n- Contract lifecycle management through `client.contracts`.\n" +
      "  Includes renewal and termination.\n\n### Fixed\n\n- Literal $(text).\n",
    );
  });

  it.each([
    ["## [2.5.1] - 2026-10-19\n- Older change.", "exactly one section"],
    ["## [2.6.0] - 2026-10-28\n\n### Added\n", "describe changes"],
    ["## [2.6.0] - 2026-10-28\n- One.\n## [2.6.0] - 2026-10-28\n- Two.", "exactly one section"],
  ])("rejects missing, empty or duplicate notes: %s", (changelog, error) => {
    const result = releaseNotes(changelog);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(error);
  });

  it("rejects a tag that differs from the package version", () => {
    const result = releaseNotes("## [2.6.0] - 2026-10-28\n- Change.", "v2.5.1");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must match package.json");
  });

  it("has changes for the package being released", () => {
    const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
    const result = spawnSync(process.execPath, [notesScript, `v${version}`], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)), encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("### Added");
  });
});

function runRelease(state: "missing" | "draft" | "published", fail?: string) {
  const cwd = fixture();
  mkdirSync(join(cwd, "package"));
  writeFileSync(join(cwd, "package", "sdk.tgz"), "verified package");
  writeFileSync(join(cwd, "package", "release-notes.md"), "- Release changes.\n");
  writeFileSync(join(cwd, "gh"), `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync("calls.jsonl", JSON.stringify(args) + "\\n");
if (args[1] === process.env.FAIL_COMMAND) process.exit(1);
if (args[1] === "view") {
  if (process.env.RELEASE_STATE === "missing") process.exit(1);
  console.log(process.env.RELEASE_STATE === "draft" ? "true" : "false");
}
`, { mode: 0o755 });
  const step = workflow.split("      - name: Create GitHub Release\n")[1]!;
  const script = step.split("        run: |\n")[1]!
    .split("\n").map((line) => line.slice(10)).join("\n");
  const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", script], {
    cwd, encoding: "utf8",
    env: { ...process.env, PATH: `${cwd}:${process.env.PATH}`, RELEASE_TAG: "v2.6.0", RELEASE_STATE: state, FAIL_COMMAND: fail },
  });
  const calls = readFileSync(join(cwd, "calls.jsonl"), "utf8").trim().split("\n")
    .map((line) => JSON.parse(line) as string[]);
  return { result, calls };
}

describe("GitHub Release workflow", () => {
  it("creates a draft for an existing tag, uploads the verified package, then publishes with changes", () => {
    const { result, calls } = runRelease("missing");
    expect(result.status, result.stderr).toBe(0);
    expect(calls.map((call) => call[1])).toEqual(["view", "create", "upload", "edit"]);
    expect(calls[1]).toEqual(["release", "create", "v2.6.0", "--verify-tag", "--draft", "--title", "v2.6.0", "--notes-file", "package/release-notes.md"]);
    expect(calls[2]).toEqual(["release", "upload", "v2.6.0", "./package/sdk.tgz", "--clobber"]);
    expect(calls[3]).toEqual(["release", "edit", "v2.6.0", "--verify-tag", "--draft=false", "--title", "v2.6.0", "--notes-file", "package/release-notes.md"]);
  });

  it("resumes an interrupted draft without creating another release", () => {
    const { result, calls } = runRelease("draft");
    expect(result.status).toBe(0);
    expect(calls.map((call) => call[1])).toEqual(["view", "upload", "edit"]);
  });

  it("leaves an already published release and its assets intact", () => {
    const { result, calls } = runRelease("published");
    expect(result.status).toBe(0);
    expect(calls.map((call) => call[1])).toEqual(["view"]);
  });

  it.each(["create", "upload"])("stops before publication when %s fails", (command) => {
    const { result, calls } = runRelease("missing", command);
    expect(result.status).not.toBe(0);
    expect(calls.at(-1)?.[1]).toBe(command);
    expect(calls.some((call) => call[1] === "edit")).toBe(false);
  });
});
