import type { ClientRequest, IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, runnerImport, type Plugin, type ProxyOptions } from "vite";

interface SampleServer {
  url: string;
  stop(): Promise<void>;
}

/** True when the request's Origin is the page served by this dev server. */
function fromDevPage(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin || !req.headers.host) return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/**
 * Dev and preview only: starts a real ViewerServer (from ../src, through Vite's
 * module runner) seeded with sample models, and proxies the page's WebSocket and
 * HTTP calls to it. The viewer server only accepts its own Origin, so requests
 * from this dev server's page are re-labelled with it; anything else keeps its
 * Origin and is rejected as usual.
 */
function sampleViewerServer(): Plugin {
  let sample: SampleServer | undefined;
  const stop = () => {
    void sample?.stop();
    sample = undefined;
  };
  return {
    name: "sample-viewer-server",
    apply: "serve",
    async config() {
      const entry = fileURLToPath(new URL("./dev/sample-server.ts", import.meta.url));
      const { module } = await runnerImport<{ startSampleServer(): Promise<SampleServer> }>(entry);
      sample = await module.startSampleServer();
      const target = sample.url;
      const api: ProxyOptions = {
        target,
        changeOrigin: true,
        configure(proxy) {
          const relabel = (proxyReq: ClientRequest, req: IncomingMessage) => {
            if (fromDevPage(req)) proxyReq.setHeader("origin", target);
          };
          proxy.on("proxyReq", relabel);
          proxy.on("proxyReqWs", relabel);
        },
      };
      return {
        server: {
          proxy: {
            "/ws": { ...api, ws: true },
            "/mesh/": api,
            "/model/": api,
            "/open-in-slicer/": api,
          },
        },
      };
    },
    configureServer(server) {
      server.httpServer?.once("close", stop);
    },
    configurePreviewServer(server) {
      server.httpServer.once("close", stop);
    },
  };
}

export default defineConfig({
  plugins: [svelte({ configFile: false }), sampleViewerServer()],
  build: {
    // tsc compiles the server into dist/; src/viewer already owns dist/viewer.
    outDir: "../dist/viewer-ui",
    emptyOutDir: true,
    // three.js is most of the bundle; it is served from localhost, so size matters little.
    chunkSizeWarningLimit: 1024,
    reportCompressedSize: false,
    // Keep three.js's MIT @license header in the minified bundle.
    rolldownOptions: { output: { comments: { legal: true } } },
  },
});
