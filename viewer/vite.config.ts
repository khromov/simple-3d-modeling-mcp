import type { ClientRequest, IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, runnerImport, type Plugin, type ProxyOptions } from "vite";

interface SampleServer {
  url: string;
  stop(): Promise<void>;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * True when the request comes from the page this dev server serves: the Origin
 * names this server and the Host is a loopback name. A DNS-rebinding page also
 * sends a matching Origin and Host, but its Host is the attacker's domain.
 */
function fromDevPage(req: IncomingMessage): boolean {
  const { origin, host } = req.headers;
  if (!origin || !host) return false;
  try {
    const url = new URL(origin);
    return url.host === host && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Dev and preview only: starts a real ViewerServer (from ../src, through Vite's
 * module runner) seeded with sample models, and proxies the page's WebSocket and
 * HTTP calls to it. The viewer server only accepts its own Origin, so requests
 * from this dev server's page are re-labelled with it; anything else keeps its
 * Origin and is rejected as usual. CORS is off, as on the real viewer server,
 * so other local pages cannot read the proxied responses either.
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
          // Vite's default reflects any localhost Origin; the page itself is same-origin.
          cors: false,
          proxy: {
            "/ws": { ...api, ws: true },
            "/mesh/": api,
            "/source/": api,
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
    // License texts of everything bundled (three.js, Svelte, …), shipped next to the page.
    license: { fileName: "THIRD-PARTY-LICENSES.md" },
    // Also keep three.js's @license header in the minified bundle.
    rolldownOptions: { output: { comments: { legal: true } } },
  },
});
