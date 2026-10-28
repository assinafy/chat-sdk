import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
if (process.argv[2] !== `v${version}`) {
  throw new Error(`Release tag must match package.json: v${version}`);
}

const sections = readFileSync("CHANGELOG.md", "utf8").split(/^## /m).slice(1);
const matching = sections.filter((section) => section.startsWith(`[${version}] - `));
if (matching.length !== 1) {
  throw new Error(`CHANGELOG.md must contain exactly one section for ${version}`);
}

const notes = matching[0].slice(matching[0].indexOf("\n") + 1).trim();
if (!/^[-*] \S/m.test(notes)) {
  throw new Error(`CHANGELOG.md must describe changes for ${version}`);
}
process.stdout.write(`${notes}\n`);
