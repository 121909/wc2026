import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const sharedAliases = {
  "@m3u-mixer/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
  "@m3u-mixer/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
  "@m3u-mixer/service": path.resolve(__dirname, "../../packages/service/src/index.ts")
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: sharedAliases
    },
    build: {
      rollupOptions: {
        external: ["better-sqlite3"]
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: sharedAliases
    }
  },
  renderer: {
    resolve: {
      alias: {
        ...sharedAliases,
        "@renderer": path.resolve(__dirname, "src/renderer/src")
      }
    },
    plugins: [react()]
  }
});
