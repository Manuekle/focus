import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
export default defineConfig([
  ...nextVitals, ...nextTs,
  globalIgnores([".next/**", "public/**", "next-env.d.ts", "**/*.js", "**/*.d.ts"]),
  { files: ["components/**/*.{ts,tsx}"], rules: { "@next/next/no-img-element": "off" } },
  { rules: { "@typescript-eslint/no-unused-vars": ["warn", {"argsIgnorePattern":"^_"}], "react-hooks/set-state-in-effect": "off", "react-hooks/refs": "off", "react-hooks/purity": "off", "react-hooks/immutability": "off" } },
]);
