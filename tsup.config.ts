import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
) as { version: string };

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "client/index": "src/client/index.ts",
    "cards/index": "src/cards/index.ts",
    "adapters/index": "src/adapters/index.ts",
    "state/index": "src/state/index.ts",
    "ai/index": "src/ai/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: "node24",
  // Inject the package version so the client's User-Agent never drifts.
  define: {
    __SDK_VERSION__: JSON.stringify(pkg.version),
  },
});
