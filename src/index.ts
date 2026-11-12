#!/usr/bin/env node

/**
 * simple-3d-modeling-mcp — zero-setup MCP server for LLM-driven 3D modelling.
 * Uses bundled OpenSCAD WASM, or a native OpenSCAD when available.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readConfig } from "./config.js";
import { createEngine } from "./engine/index.js";
import { createServer } from "./server.js";

const log = (message: string) => console.error(`[simple-3d-modeling-mcp] ${message}`);

async function main() {
  const { config, warnings } = readConfig();
  warnings.forEach(log);

  const notes = [...warnings];
  const engine = createEngine({
    mode: config.engineMode,
    executablePath: config.openscadPath,
    workDir: config.workDir,
    timeoutMs: config.timeoutMs,
    log: (message) => {
      notes.push(message);
      log(message);
    },
  });
  engine.then((e) => log(`using the ${e.name} engine`)).catch(() => {});

  const app = createServer({
    engine,
    outputDir: config.outputDir,
    autoOpenViewer: config.autoOpenViewer,
    notes,
  });

  let closing = false;
  const shutdown = async (code: number) => {
    if (closing) return;
    closing = true;
    await app.close().catch(() => {});
    process.exit(code);
  };
  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));
  process.stdin.on("close", () => void shutdown(0));

  await app.server.connect(new StdioServerTransport());
}

main().catch((err) => {
  log(`fatal: ${err?.stack ?? err}`);
  process.exit(1);
});
