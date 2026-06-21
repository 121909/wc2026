import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { ensureDir } from "./utils";

export type HlsServerHandle = {
  origin: string;
  close: () => Promise<void>;
};

export async function startHlsServer(options: {
  rootDir: string;
  bindHost: string;
  port: number;
  routePrefix: string;
}): Promise<HlsServerHandle> {
  await ensureDir(options.rootDir);

  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        res.writeHead(400).end("Bad Request");
        return;
      }

      const normalized = decodeURIComponent(req.url.split("?")[0] ?? "");
      if (!normalized.startsWith(options.routePrefix)) {
        res.writeHead(404).end("Not Found");
        return;
      }

      const relativePath = normalized.slice(options.routePrefix.length);
      const safePath = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
      const filePath = path.join(options.rootDir, safePath);
      const content = await fs.readFile(filePath);
      if (filePath.endsWith(".m3u8")) {
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      } else if (filePath.endsWith(".ts")) {
        res.setHeader("Content-Type", "video/mp2t");
      } else {
        res.setHeader("Content-Type", "application/octet-stream");
      }
      res.writeHead(200).end(content);
    } catch (error) {
      res.writeHead(503).end(error instanceof Error ? error.message : "Unavailable");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.bindHost, () => resolve());
  });

  return {
    origin: `http://${options.bindHost}:${options.port}`,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      })
  };
}
