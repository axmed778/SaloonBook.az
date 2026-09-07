import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

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
});
