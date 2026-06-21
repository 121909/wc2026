import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "@m3u-mixer/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
      "@m3u-mixer/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@m3u-mixer/service": path.resolve(__dirname, "packages/service/src/index.ts")
    }
  }
});
