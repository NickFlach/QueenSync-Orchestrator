import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Pin workspace packages to a single canonical absolute path so that
      // every importer (this test file AND the in-process api-server source we
      // boot here) shares the same module instance — and therefore the same
      // pg.Pool / NATS in-memory client / generated api-client base URL.
      "@workspace/db": path.resolve(__dirname, "../../lib/db/src/index.ts"),
      "@workspace/nats": path.resolve(__dirname, "../../lib/nats/src/index.ts"),
      "@workspace/api-client-react": path.resolve(
        __dirname,
        "../../lib/api-client-react/src/index.ts",
      ),
      "@workspace/api-zod": path.resolve(
        __dirname,
        "../../lib/api-zod/src/index.ts",
      ),
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    css: false,
    server: {
      deps: {
        // Force every module to go through Vite's transform pipeline (which
        // honours our resolve.alias entries) instead of being externalized
        // to Node's module loader. Without this, `import app from
        // "../../../../api-server/src/app"` loads the api-server source via
        // Node, which then resolves `@workspace/db` to its own copy and
        // creates a second pg.Pool — so writes from the test process are
        // not visible to the in-proc Express server's queries even though
        // both target the same DATABASE_URL.
        inline: true,
      },
    },
  },
});
