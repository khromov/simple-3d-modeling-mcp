import { defineConfig } from "vitest/config";

// tests/package-manifest.test.ts runs a full `npm run build`, which deletes and
// rebuilds dist/, while the viewer tests serve the page from dist/viewer-ui.
// It therefore runs on its own, after everything else.
const PACKAGE_TEST = "tests/package-manifest.test.ts";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/**/*.test.ts"], exclude: [PACKAGE_TEST] } },
      { extends: true, test: { name: "package", include: [PACKAGE_TEST], sequence: { groupOrder: 1 } } },
    ],
  },
});
