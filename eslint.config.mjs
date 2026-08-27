import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

// ESLint 9 flat config. Deliberately NOT type-aware (no projectService): the
// type-checked typescript-eslint preset re-runs the whole TS program on every
// lint, which would roughly double CI time for rules `pnpm typecheck` already
// covers. Correctness-by-types is typecheck's job; this is the fast pass.
export default tseslint.config(
  {
    // Build output, generated files and vendored trees. prisma/migrations is
    // raw SQL, public/ holds the Serwist-generated service worker (public/sw.js
    // is a build artifact — see next.config.ts), and .claude/ contains agent
    // worktrees that duplicate the entire source tree.
    ignores: [
      "node_modules/**",
      ".next/**",
      "dist/**",
      "build/**",
      "out/**",
      "coverage/**",
      "e2e/.artifacts/**",
      "prisma/migrations/**",
      "public/**",
      ".claude/**",
      ".devdb/**",
      "next-env.d.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Next.js core-web-vitals, spread from the plugin's own flat config so the
  // rule list tracks upstream instead of being re-listed (and going stale) here.
  {
    name: "salonbook/next-core-web-vitals",
    plugins: nextPlugin.configs["core-web-vitals"].plugins,
    rules: nextPlugin.configs["core-web-vitals"].rules,
  },

  {
    name: "salonbook/base",
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      // One global set for the whole repo: server code (worker/, scripts/,
      // route handlers) is Node, client components and src/app/sw.ts are
      // browser/worker. Splitting per-directory buys nothing here because
      // no-undef is off in TS files anyway (tseslint's eslint-recommended).
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Only the two classic hook rules. eslint-plugin-react-hooks v7 ships the
      // full React Compiler rule set in `recommended` (purity, immutability,
      // set-state-in-effect, …); those are opinions about a compiler this app
      // does not enable yet, and turning them on wholesale would bury the real
      // findings. rules-of-hooks catches genuine crashes, and exhaustive-deps
      // catches genuine stale-closure bugs — both stay on.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // `cond && doThing()` as a statement is used deliberately in this
      // codebase (debounce cleanup, optional callbacks). The rule still earns
      // its place for the real bug it catches: an expression like `foo.bar;`
      // or a forgotten call `doThing;` that silently does nothing.
      "@typescript-eslint/no-unused-expressions": [
        "error",
        { allowShortCircuit: true, allowTernary: true },
      ],

      // Warn, not error: an unused local is a cleanliness issue, never a
      // runtime bug, and a hard failure here turns CI red on work-in-progress
      // branches. `_`-prefixed names are the explicit "intentionally unused"
      // opt-out (destructuring a field just to drop it, ignored catch params).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],

      // Dead-store detection that false-positives on the pattern this codebase
      // uses to keep TypeScript's definite-assignment analysis happy:
      //   let x: T = fallback; try { x = await …; } catch { … }
      // Useful signal, not worth failing a build over.
      "no-useless-assignment": "warn",
    },
  },

  // Playwright specs run in Node against a real server; `page`/`expect` come
  // from imports, but the suite legitimately uses long assertions and
  // conditional flow that the app-side rules above never see.
  {
    name: "salonbook/e2e",
    files: ["e2e/**/*.ts", "playwright.config.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
);
