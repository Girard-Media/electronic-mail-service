// Shared flat config for every workspace package except apps/web, which has its
// own Next.js config. Kept deliberately small: rules that catch real defects,
// not a style catalogue (E22-072).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores([
    "**/dist/**",
    "**/.next/**",
    "**/node_modules/**",
    "**/src/generated/**",
    "apps/web/**",
  ]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        URL: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        AbortController: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        crypto: "readonly",
        __dirname: "readonly",
        NodeJS: "readonly",
      },
    },
    rules: {
      // Unused args are fine when prefixed — the send-path contracts are full of
      // deliberately-unimplemented signatures that must keep their shape.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // `any` is a correctness hole in a send path. Warn now, error once the
      // inherited code is cleaned up (tracked in E01-009b).
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": "off",
      eqeqeq: ["error", "smart"],
      "prefer-const": "error",
      "no-var": "error",
      // Deliberately off. It fires on idiomatic `+value.toFixed(1)`, which is
      // style churn rather than a defect.
      "no-implicit-coercion": "off",
      // Deliberately off. It flags a defensive initializer before a try/catch
      // where both branches assign — removing that initializer makes the code
      // worse, not better.
      "no-useless-assignment": "off",
    },
  },
  {
    files: ["**/*.mts", "scripts/**/*"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
]);
