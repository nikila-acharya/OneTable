import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vercel's machine-written project metadata (already gitignored). It is not
    // source, and the CLI rewrites it, so linting it couples `npm run lint` to
    // whatever tool files happen to be sitting in the working tree.
    ".vercel/**",
  ]),
]);

export default eslintConfig;
