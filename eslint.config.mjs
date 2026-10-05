import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: [".next/**", "out/**", "coverage/**", "src/generated/**", "next-env.d.ts", "node_modules/**"] },
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    rules: {
      // CONTRIBUTING: no `any` without a comment explaining why. Unused values are almost always leftovers.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "error",
    },
  },
  {
    // Entry points that legitimately print: the logger itself, one-off scripts, and the browser-side error boundary.
    files: ["src/lib/log.ts", "scripts/**", "src/app/error.tsx"],
    rules: { "no-console": "off" },
  },
);
