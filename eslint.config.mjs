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
    ".next_old_trae/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Coverage reports (Istanbul / Jest LCOV generated, never lint)
    "coverage/**",
    // Node modules + lock
    "node_modules/**",
    // Generated PDF / binary outputs
    "reports/**/*.pdf",
    // Tailwind CDN JS offline cache (511KB minified/bundled de third-party, NO our-code)
    "reports/.cdn-tailwindcss.js",
    // Prisma client generated
    "node_modules/.prisma/**",
  ]),
  // Scripts operativos (seed / sast / payloads / FIEL generation): reglas relajadas
  // ya que son herramientas one-shot de desarrollo, no runtime productivo.
  {
    files: ["scripts/**/*.{ts,tsx,mts,cts,js,mjs,cjs}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "prefer-const": "off",
      "max-len": "off",
      "no-unused-vars": "off",
      // eslint-disable directives sobrantes (ej: /* eslint-disable max-len */ sin usos):
      "unused-eslint-disable/no-unused-eslint-disable": "off",
      "eslint-comments/no-unused-disable": "off",
    },
  },
]);

export default eslintConfig;
