import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";

const baseDirectory = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory });

export default [
  {
    ignores: [
      ".next/**",
      ".pnpm-store/**",
      ".vercel/**",
      "android/**",
      "ios/**",
      "node_modules/**",
      "tmp/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "plugin:@typescript-eslint/recommended"),
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
