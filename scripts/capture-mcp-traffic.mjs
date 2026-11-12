#!/usr/bin/env node
/**
 * Records the JSON-RPC traffic of the built server over real stdio, so two
 * builds (e.g. before/after an MCP library change) can be compared with diff.
 *
 * Usage: node scripts/capture-mcp-traffic.mjs <out.json> [server entry, default dist/index.js]
 *
 * Every request is sent raw (no MCP client library) and every line the server
 * writes is recorded. Volatile values are masked: the temp export folder,
 * viewer port, evaluation time, and binary payloads (replaced by size + hash).
 * open_viewer is skipped because it opens a real browser.
 *
 * Each call also has an expected outcome (result, isError result, JSON-RPC
 * error, or no reply). The script exits with 1 when an outcome differs, a
 * request goes unanswered, the server prints non-JSON to stdout, or a server
 * process exits non-zero, so CI also runs it as a stdio
 * smoke test (on Node, on Bun, and against the bundled .mcpb). It stops at the
 * first unanswered request instead of waiting out every timeout.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const [outFile, entry = "dist/index.js"] = process.argv.slice(2);
if (!outFile) {
  console.error("Usage: node scripts/capture-mcp-traffic.mjs <out.json> [server entry]");
  process.exit(2);
}

const REQUEST_TIMEOUT_MS = 120_000;
const QUIET_MS = 150; // how long to listen for stray messages after a notification
const LONG_TEXT = 1500;

const sha = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 16);

// ---------------------------------------------------------------------------
// One server process = one MCP session
// ---------------------------------------------------------------------------

function startSession(outDir) {
  const child = spawn(process.execPath, [resolve(entry)], {
    env: { ...process.env, OPENSCAD_ENGINE: "wasm", OPENSCAD_AUTO_OPEN_VIEWER: "false", OPENSCAD_OUTPUT_DIR: outDir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.on("error", () => {}); // EPIPE after a crash shows up as a missing response instead
  const inbox = [];
  const waiters = [];
  const stderr = [];
  createInterface({ input: child.stdout }).on("line", (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      msg = { __unparseable_stdout_line: line };
    }
    inbox.push(msg);
    for (const w of [...waiters]) w();
  });
  createInterface({ input: child.stderr }).on("line", (line) => stderr.push(line));
  let hasExited = false;
  const exited = new Promise((r) =>
    child.on("exit", (code, signal) => {
      hasExited = true;
      r({ code, signal });
      for (const w of [...waiters]) w();
    }),
  );

  /** Collect everything received until `done(inbox)` is true, the server exits, or the timeout hits. */
  const until = (done, timeoutMs) =>
    new Promise((res) => {
      const finish = () => {
        clearTimeout(timer);
        waiters.splice(waiters.indexOf(check), 1);
        res(inbox.splice(0));
      };
      const check = () => (done(inbox) || hasExited) && finish();
      const timer = setTimeout(finish, timeoutMs);
      waiters.push(check);
      check();
    });

  const answered = (box, id) => box.some((m) => m.id === id && !("method" in m));
  /** Waits for the response to `id`; throws if the server exits or the timeout hits first. */
  const awaitResponse = async (id, what) => {
    const received = await until((box) => answered(box, id), REQUEST_TIMEOUT_MS);
    if (!answered(received, id)) {
      throw new Error(`no response to ${what} (${hasExited ? "server exited" : `timed out after ${REQUEST_TIMEOUT_MS / 1000}s`})`);
    }
    return received;
  };

  return {
    async request(id, method, params) {
      const msg = { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };
      child.stdin.write(JSON.stringify(msg) + "\n");
      return { send: msg, receive: await awaitResponse(id, method) };
    },
    async notify(method, params) {
      const msg = { jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) };
      child.stdin.write(JSON.stringify(msg) + "\n");
      return { send: msg, receive: await until(() => false, QUIET_MS) };
    },
    async raw(line) {
      child.stdin.write(line + "\n");
      return { send: line, receive: await until((box) => box.length > 0, 2000) };
    },
    async close() {
      child.stdin.end();
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      const exit = await exited;
      clearTimeout(timer);
      return { exit, stderr };
    },
  };
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function makeNormalizer(outDir) {
  const real = realpathSync(outDir);
  const dirs = [...new Set([real, outDir])].sort((a, b) => b.length - a.length);
  const urls = dirs.map((d) => pathToFileURL(d).href);

  const str = (s) => {
    for (const u of urls) s = s.split(u).join("file://<OUT>");
    for (const d of dirs) s = s.split(d).join("<OUT>");
    return s
      .replace(/http:\/\/(localhost|127\.0\.0\.1):\d+/g, "http://$1:<PORT>")
      .replace(/evaluated in \d+(\.\d+)?s/g, "evaluated in <T>s")
      .replace(/\bin \d+(\.\d+)? ?ms\b/g, "in <T>ms");
  };

  const walk = (v, key) => {
    if (typeof v === "string") {
      if ((key === "data" || key === "blob") && v.length > 64) {
        const bytes = Buffer.from(v, "base64");
        return `<base64 ${bytes.length} bytes sha256:${sha(bytes)}>`;
      }
      const s = str(v);
      return s.length > LONG_TEXT ? `<text ${s.length} chars sha256:${sha(s)}> ${s.slice(0, 200)}…` : s;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  return walk;
}

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

const CLIENT = { name: "traffic-capture", version: "1.0.0" };
const init = (protocolVersion) => ["initialize", { protocolVersion, capabilities: {}, clientInfo: CLIENT }];

async function mainSession(s, rec) {
  let id = 0;
  const req = async (label, method, params, expect = "result", check) => rec(label, await s.request(++id, method, params), expect, check);
  const call = (label, name, args, expect = "result") =>
    req(`tools/call ${name}: ${label}`, "tools/call", { name, ...(args !== undefined ? { arguments: args } : {}) }, expect);

  await req("initialize", ...init("2025-06-18"), "result", (r) =>
    r.result.serverInfo?.name === "sketchpad-3d-model-mcp" ? undefined : `unexpected serverInfo ${JSON.stringify(r.result.serverInfo)}`,
  );
  rec("notifications/initialized", await s.notify("notifications/initialized"), "none");
  await req("ping", "ping");
  await req("tools/list", "tools/list", undefined, "result", (r) =>
    ["render", "export", "validate"].every((n) => r.result.tools?.some((t) => t.name === n)) ? undefined : "tools/list is missing core tools",
  );
  await req("resources/list", "resources/list");
  await req("resources/templates/list", "resources/templates/list");
  await req("resources/read cheatsheet", "resources/read", { uri: "openscad://cheatsheet" });
  await req("resources/read unknown", "resources/read", { uri: "openscad://nope" }, "error");
  await req("prompts/list (no prompts)", "prompts/list", undefined, "error");
  await req("logging/setLevel (no logging capability)", "logging/setLevel", { level: "info" }, "error");
  // The SDK answered with "method not found"; tmcp with a null result. Clients only call it when `completions` is advertised.
  await req("completion/complete (unsupported)", "completion/complete", { ref: { type: "ref/resource", uri: "openscad://cheatsheet" }, argument: { name: "x", value: "" } }, "any");
  await req("unknown method", "does/not/exist", undefined, "error");

  // Simple informational tools
  await call("ok", "get_version");
  await call("ok", "list_libraries");
  await call("ok", "cheatsheet");

  // validate
  await call("ok with echo", "validate", { code: 'echo("ok"); cube(1);' });
  await call("assert failure", "validate", { code: 'assert(false, "too thin");' }, "isError");

  // render
  await call("ok", "render", { code: '// Test block\necho("w", 40);\ncube([40, 20, 10]);', width: 320, height: 240 });
  await call("cached", "render", { code: '// Test block\necho("w", 40);\ncube([40, 20, 10]);', width: 320, height: 240, view: "top" });
  await call("orthographic + params", "render", { code: "cube([w, 5, 5]);", params: { w: 12 }, projection: "orthographic", width: 128, height: 128, title: "param cube" });
  await call("syntax error", "render", { code: "cube([10, 10, 10);" }, "isError");
  await call("empty geometry", "render", { code: "difference() { cube(5); cube(10); }" }, "isError");
  await call("invalid view", "render", { code: "cube(1);", view: "sideways" }, "isError");
  await call("no source", "render", {}, "isError");
  await call("width out of range (schema)", "render", { code: "cube(1);", width: 100000 }, "isError");
  await call("wrong type (schema)", "render", { code: 42 }, "isError");
  await call("no arguments object", "render", undefined, "isError");

  // render_multiview / render_turntable
  await call("default views", "render_multiview", { code: "cube([10, 20, 30]);", width: 128, height: 128 });
  await call("custom views", "render_multiview", { code: "cube(1);", views: ["iso", "bottom"], width: 128, height: 128 });
  await call("bad view enum (schema)", "render_multiview", { code: "cube(1);", views: ["sideways"] }, "isError");
  await call("4 frames", "render_turntable", { code: "cube(5);", frames: 4, width: 128, height: 128 });

  // export
  await call("3mf with title", "export", { code: 'color("red") cube(10);', format: "3mf", title: "Red cube" });
  await call("3mf again (numbered name)", "export", { code: 'color("red") cube(10);', format: "3mf", title: "Red cube" });
  await call("stl inferred from path, embedded", "export", { code: "cube(2);", path: "nested/part.stl", embed: true });
  await call("obj", "export", { code: "cube(2);", format: "obj", title: "obj part" });
  await call("format/path mismatch", "export", { code: "cube(1);", path: "x.3mf", format: "stl" }, "isError");
  await call("svg 2D", "export", { code: "square([20, 10]);", format: "svg", title: "plate" });
  await call("2D as stl", "export", { code: "square([20, 10]);", format: "stl" }, "isError");
  await call("unsupported format (schema)", "export", { code: "cube(1);", format: "step" }, "isError");

  // .scad files
  await call("lib", "save_scad_file", { path: "proj/parts/lib.scad", code: "module part(s) { cube(s); }\n" });
  await call("main", "save_scad_file", { path: "proj/main.scad", code: "use <parts/lib.scad>\npart(6);\n" });
  await call("exists", "save_scad_file", { path: "proj/main.scad", code: "cube(1);" }, "isError");
  await call("wrong extension", "save_scad_file", { path: "x.sh", code: "rm -rf /" }, "isError");
  await call("missing code (schema)", "save_scad_file", { path: "y.scad" }, "isError");
  await call("ok", "read_scad_file", { path: "<OUT>/proj/main.scad" });
  await call("missing file", "read_scad_file", { path: "<OUT>/proj/nope.scad" }, "isError");
  await call("render from file with relative use", "render", { file: "<OUT>/proj/main.scad", width: 64, height: 64 });

  // errors
  await call("unknown tool", "no_such_tool", {}, "isError");
  await req("tools/call without params", "tools/call", undefined, "error");
}

async function main() {
  const outDir = mkdtempSync(join(tmpdir(), "mcp-traffic-"));
  const normalize = makeNormalizer(outDir);
  const transcript = { entry, sessions: [] };
  const problems = [];

  /** Returns why an exchange doesn't match `expect` ("result" | "isError" | "error" | "none" | "any"), or undefined. */
  const mismatch = (ex, expect) => {
    if (expect === "any") return undefined;
    if (expect === "none") return ex.receive.length ? `expected no reply, got ${ex.receive.length} message(s)` : undefined;
    const r = ex.receive.find((m) => m.id === ex.send.id && !("method" in m));
    const got = r?.error ? "JSON-RPC error" : r?.result?.isError ? "isError result" : r ? "result" : "no response";
    const want = { result: "result", isError: "isError result", error: "JSON-RPC error" }[expect];
    return got === want ? undefined : `expected ${want}, got ${got}`;
  };

  /** Runs one session; returns false if it had to be aborted (no point starting more). */
  const run = async (name, scenario) => {
    const s = startSession(outDir);
    const exchanges = [];
    // "<OUT>" in arguments is a placeholder for the temp folder
    const fill = (v) => JSON.parse(JSON.stringify(v).split("<OUT>").join(outDir.replace(/\\/g, "\\\\")));
    const wrapped = {
      request: (id, method, params) => s.request(id, method, params === undefined ? undefined : fill(params)),
      notify: s.notify,
      raw: s.raw,
    };
    const rec = (label, ex, expect = "result", check) => {
      exchanges.push({ label, send: normalize(ex.send), receive: normalize(ex.receive) });
      const issues = [];
      for (const m of ex.receive) if ("__unparseable_stdout_line" in m) issues.push(`non-JSON on stdout: ${m.__unparseable_stdout_line.slice(0, 120)}`);
      const wrong = mismatch(ex, expect);
      if (wrong) issues.push(wrong);
      const response = typeof ex.send === "object" ? ex.receive.find((m) => m.id === ex.send.id && !("method" in m)) : undefined;
      const checked = !wrong && check && response?.result ? check(response) : undefined;
      if (checked) issues.push(checked);
      for (const issue of issues) problems.push(`[${name}] ${label}: ${issue}`);
      const last = ex.receive.at(-1);
      process.stderr.write(`[${name}] ${label}${last?.error ? " → JSON-RPC error" : last?.result?.isError ? " → isError" : ""}${issues.length ? `  ✗ ${issues.join("; ")}` : ""}\n`);
    };
    let completed = true;
    try {
      await scenario(wrapped, rec);
    } catch (e) {
      problems.push(`[${name}] aborted: ${e.message}`);
      process.stderr.write(`[${name}] ✗ aborted: ${e.message}\n`);
      completed = false;
    }
    const { exit, stderr } = await s.close();
    if (exit.code !== 0) problems.push(`[${name}] server exited with ${JSON.stringify(exit)}`);
    transcript.sessions.push({ name, exchanges, exit, stderr: normalize(stderr) });
    return completed;
  };

  try {
    const sessions = [
      ["main", mainSession],
      ...["2025-11-25", "2025-03-26", "2024-11-05", "1999-01-01"].map((v) => [
        `negotiate ${v}`,
        async (s, rec) => rec("initialize", await s.request(1, ...init(v))),
      ]),
      // The SDK accepted any string here; tmcp rejects a malformed version.
      ["negotiate garbage", async (s, rec) => rec("initialize", await s.request(1, ...init("garbage")), "any")],
      ["before initialize", async (s, rec) => rec("tools/list before initialize", await s.request(1, "tools/list"))],
      [
        "malformed input",
        async (s, rec) => {
          rec("initialize", await s.request(1, ...init("2025-06-18")));
          rec("invalid JSON line", await s.raw("{not json"), "none");
          rec("request without jsonrpc field", await s.raw(JSON.stringify({ id: 2, method: "ping" })), "any");
          rec("ping still works", await s.request(3, "ping"));
        },
      ],
    ];
    for (const [name, scenario] of sessions) {
      if (!(await run(name, scenario))) break;
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }

  writeFileSync(outFile, JSON.stringify(transcript, null, 2) + "\n");
  console.error(`Wrote ${outFile}`);
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):\n${problems.join("\n")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
