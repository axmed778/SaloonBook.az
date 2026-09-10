import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// The unit suite has no config of its own historically — every test sat next to
// its subject and imported it relatively. That stops working the moment a test
// covers a module under src/app, which imports its dependencies through the
// "@/" alias exactly as the app does. Teaching Vitest the same alias tsconfig
// already declares is the whole of this file.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    exclude: [
      ...configDefaults.exclude,
      // Git worktrees live inside the repo (.claude/worktrees/<name>), so every
      // one of them carries its own copy of src/**. Without this the suite runs
      // each worktree's tests too: `vitest run src` reported 58 files and 626
      // tests against 17 real files, most of them stale duplicates from
      // branches that were finished months ago.
      ".claude/worktrees/**",
      // Playwright specs — `test.describe` from @playwright/test throws when
      // Vitest is the runner. `pnpm e2e` runs these.
      "e2e/**",
    ],
  },
});
