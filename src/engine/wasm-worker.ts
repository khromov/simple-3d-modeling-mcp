/**
 * Worker thread that executes OpenSCAD WASM jobs.
 *
 * Running OpenSCAD off the main thread keeps the MCP connection and the
 * viewer responsive during long renders, and lets the engine enforce a
 * timeout by terminating the worker.
 *
 * This file must not import project modules: under tests it is executed
 * straight from TypeScript using Node's built-in type stripping.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parentPort, workerData } from "node:worker_threads";

export interface WorkerInit {
  /** file:// URL of openscad-wasm's entry module. */
  openscadUrl: string;
  fontsDir: string;
  librariesDir: string;
}

export interface WorkerJob {
  id: number;
  args: string[];
  files: Array<{ path: string; data: Uint8Array }>;
  /** Virtual path to read back after the run (optional). */
  outputPath?: string;
  /** Mount bundled fonts and point fontconfig at them. */
  fonts: boolean;
  /** Bundled libraries to mount under /libraries (added to OPENSCADPATH). */
  libraries: string[];
}

export interface WorkerReply {
  id: number;
  exitCode: number;
  lines: string[];
  output?: Uint8Array;
  crash?: string;
}

type FileList = Array<[string, Uint8Array]>;
type CreateOpenSCAD = (opts: Record<string, unknown>) => Promise<{ getInstance(): any }>;

const FONTS_CONF = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>/fonts</dir>
  <cachedir>/tmp/fontconfig</cachedir>
  <alias><family>Liberation Sans</family><prefer><family>DejaVu Sans</family></prefer></alias>
  <alias><family>Liberation Serif</family><prefer><family>DejaVu Serif</family></prefer></alias>
  <alias><family>Liberation Mono</family><prefer><family>DejaVu Sans Mono</family></prefer></alias>
  <alias><family>Arial</family><prefer><family>DejaVu Sans</family></prefer></alias>
  <alias><family>Helvetica</family><prefer><family>DejaVu Sans</family></prefer></alias>
  <alias><family>Times New Roman</family><prefer><family>DejaVu Serif</family></prefer></alias>
  <alias><family>Courier New</family><prefer><family>DejaVu Sans Mono</family></prefer></alias>
  <alias><family>sans-serif</family><prefer><family>DejaVu Sans</family></prefer></alias>
  <alias><family>serif</family><prefer><family>DejaVu Serif</family></prefer></alias>
  <alias><family>monospace</family><prefer><family>DejaVu Sans Mono</family></prefer></alias>
</fontconfig>
`;

const init = workerData as WorkerInit;
let createOpenSCAD: CreateOpenSCAD | undefined;
let fontFiles: FileList | undefined;
const libraryFiles = new Map<string, FileList>();

function readTree(dir: string, prefix = ""): FileList {
  const out: FileList = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...readTree(full, rel));
    else out.push([rel, new Uint8Array(readFileSync(full))]);
  }
  return out;
}

function parentDir(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

async function runJob(job: WorkerJob): Promise<WorkerReply> {
  createOpenSCAD ??= (await import(init.openscadUrl)).createOpenSCAD as CreateOpenSCAD;
  const lines: string[] = [];
  const wrapper = await createOpenSCAD({
    noInitialRun: true,
    print: (t: string) => lines.push(t),
    printErr: (t: string) => lines.push(t),
  });
  const inst = wrapper.getInstance();
  const FS = inst.FS;
  const write = (path: string, data: Uint8Array | string) => {
    FS.mkdirTree(parentDir(path));
    FS.writeFile(path, data);
  };

  if (job.fonts) {
    fontFiles ??= readTree(init.fontsDir).filter(([name]) => name.toLowerCase().endsWith(".ttf"));
    for (const [name, data] of fontFiles) write(`/fonts/${name}`, data);
    write("/fonts/fonts.conf", FONTS_CONF);
    FS.mkdirTree("/tmp/fontconfig");
    inst.ENV.FONTCONFIG_FILE = "/fonts/fonts.conf";
  }

  if (job.libraries.length > 0) {
    for (const lib of job.libraries) {
      let files = libraryFiles.get(lib);
      if (!files) {
        files = readTree(join(init.librariesDir, lib));
        libraryFiles.set(lib, files);
      }
      for (const [rel, data] of files) write(`/libraries/${lib}/${rel}`, data);
    }
    inst.ENV.OPENSCADPATH = "/libraries";
  }

  for (const f of job.files) write(f.path, f.data);
  if (job.outputPath) FS.mkdirTree(parentDir(job.outputPath));

  let exitCode: number;
  let crash: string | undefined;
  try {
    exitCode = inst.callMain(job.args);
  } catch (e) {
    exitCode = -1;
    crash = e instanceof Error ? e.message : String(e);
  }

  let output: Uint8Array | undefined;
  if (job.outputPath) {
    try {
      output = (FS.readFile(job.outputPath) as Uint8Array).slice();
    } catch {
      // no output (failed run)
    }
  }
  return { id: job.id, exitCode, lines, output, crash };
}

parentPort?.on("message", async (job: WorkerJob) => {
  try {
    const reply = await runJob(job);
    parentPort!.postMessage(reply, reply.output ? [reply.output.buffer as ArrayBuffer] : []);
  } catch (e) {
    parentPort!.postMessage({ id: job.id, exitCode: -1, lines: [], crash: e instanceof Error ? e.message : String(e) });
  }
});
