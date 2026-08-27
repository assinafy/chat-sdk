// @ts-check
import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  js.configs.recommended,
  {
    // Repository scripts are plain ESM run by Node, so `no-undef` needs to know
    // about the runtime globals they use. TypeScript files turn the rule off
    // entirely (see below) because the compiler already checks them.
    files: ["scripts/**/*.mjs", "*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        fetch: "readonly",
        Headers: "readonly",
        process: "readonly",
        Response: "readonly",
        URL: "readonly",
      },
    },
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      // TypeScript replaces these built-in checks.
      "no-unused-vars": "off",
      "no-undef": "off",
      "no-redeclare": "off",
      "no-dupe-class-members": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],

      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];
