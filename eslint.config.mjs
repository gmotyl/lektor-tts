// ESLint flat config: recommended rules; browser + WebExtension globals for the extension
// code in src/, Node globals for build/scripts and the tests.
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["dist/", "node_modules/", "qa/", "store/"] },
  js.configs.recommended,
  {
    // `const { omitted, ...rest } = obj` is the idiom for dropping a key.
    rules: { "no-unused-vars": ["error", { ignoreRestSiblings: true }] },
  },
  {
    files: ["src/**/*.mjs", "src/**/*.js"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.webextensions },
    },
  },
  {
    files: ["build.mjs", "eslint.config.mjs", "scripts/**/*.mjs", "**/__tests__/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
