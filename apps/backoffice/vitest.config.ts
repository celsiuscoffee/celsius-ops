import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));

// Unit tests for pure finance logic (parsers, classifiers, report math).
// Node environment; no Next/CSS pipeline needed. The `@/` alias mirrors
// tsconfig so modules that use it resolve under test.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": path.resolve(dir, "src") },
  },
});
