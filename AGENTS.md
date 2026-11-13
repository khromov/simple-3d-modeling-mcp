# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

Sketchpad 3D (`sketchpad-3d-model-mcp` on npm, formerly `@khromov/simple-3d-modeling-mcp`) is an MCP server (stdio) that lets AI assistants write OpenSCAD models, preview them, and export files. OpenSCAD runs bundled as WebAssembly (zero setup, OpenSCAD's official nightly build); an installed OpenSCAD is never used. It also ships a local browser viewer (a Vite + Svelte 5 app in `viewer/`) and a Claude Desktop `.mcpb` bundle.

## Commands

```bash
npm install
npm run assets       # populate assets/ (OpenSCAD WASM, fonts, BOSL2) — needs network the first time
npm run build        # clean dist/, fetch assets, build the viewer page (Vite → dist/viewer-ui), compile with tsc
npm run build:viewer # only the viewer page
npm run dev:viewer   # viewer UI with hot reload, against a real ViewerServer seeded with sample models
npm run typecheck    # sources (tsconfig.json), tests (tsconfig.test.json), viewer (svelte-check)
npm test             # vitest; runs `npm run assets` and `npm run build:viewer` first
npx vitest run tests/rendering/software-renderer.test.ts   # a single file
bun --bun vitest run # the same suite on the Bun runtime (CI runs latest Bun)
npm run build:mcpb   # Claude Desktop extension → sketchpad-3d.mcpb
node scripts/capture-mcp-traffic.mjs out.json   # record the built server's stdio JSON-RPC traffic (diff two runs)
```

Node 22, 24 or 26 (see `engines`; `.nvmrc` pins 22). Run `npm run typecheck` and `npm test` before finishing any change. The full suite takes about 6 seconds, but `tests/package-manifest.test.ts` downloads npm 12.2.2 via `npx`, so it needs network.

## Layout

```
src/index.ts            stdio entry point: reads env config, creates the WASM engine, starts the server (tmcp StdioTransport)
src/server.ts           every MCP tool and resource (tmcp `server.tool` / `server.resource` + titles + annotations)
src/config.ts           OPENSCAD_* environment variables
src/model-service.ts    evaluates models and caches meshes per (engine, source hash, params)
src/paths.ts            package root / assets / version lookup (works from src/, dist/ and the .mcpb)
src/cheatsheet.ts       cheatsheet text + SERVER_INSTRUCTIONS sent to clients
src/engine/
  types.ts              Engine interface, PreparedSource, RunJob/RunResult, EngineLog
  base-engine.ts        shared computeMesh (OFF/STL, 2D fallback) / exportFormat / validate on top of run()
  wasm-engine.ts        worker pool with per-job timeouts; mounts fonts/BOSL2/user files into MEMFS
  wasm-worker.ts        runs one OpenSCAD WASM instance per job; compiles openscad.wasm once per worker (see constraints below)
  source.ts             code/file input → PreparedSource; collects include/use/import dependencies
  output.ts             classifies OpenSCAD output into errors / warnings / echo
  params.ts             `-D name=value` formatting and validation
src/geometry/           Mesh type, OFF/STL parsers, stats, STL/OBJ/OFF/3MF writers, minimal zip
src/rendering/          camera conventions, software rasteriser, previews (single/multiview/turntable), PNG/APNG codec, bitmap font
src/viewer/             local HTTP + WebSocket viewer server (serves dist/viewer-ui, mesh/STL/3MF, slicer launch, version history)
viewer/                 the viewer page: Vite + Svelte 5 npm workspace, built into dist/viewer-ui (three.js bundled)
  src/App.svelte        state and layout: WebSocket connection, current model, theme, model colour
  src/app.css           design tokens (light "paper" / dark "blueprint" themes), fonts, shared .btn/.tag styles
  src/components/       TopBar (status, theme toggle), Viewport (canvas + overlays), Controls (view toolbar),
                        numbered sidebar Sections (Dimensions, History, Code, Appearance, Export), CodeView, Logo
  src/lib/highlight.ts  OpenSCAD tokenizer for the read-only code view (tokens are rendered as text, never HTML)
  src/lib/scene.ts      three.js scene: model, edges, grid, axes, lights, orbit camera
  src/lib/mesh.ts       decodes the server's binary mesh (encodeViewerMesh in src/viewer/viewer-server.ts)
  src/lib/protocol.ts   WebSocket message types the server sends
  dev/sample-server.ts  `npm run dev:viewer` backend (loaded by vite.config.ts through Vite's module runner)
scripts/fetch-assets.mjs  builds assets/ (OpenSCAD WASM, fonts, BOSL2; git-ignored, shipped in the npm package and .mcpb)
scripts/build-mcpb.sh   bundle layout: server/{dist,assets,node_modules,package.json}
scripts/capture-mcp-traffic.mjs  raw JSON-RPC capture of dist/ over stdio, volatile values masked; fails on unexpected outcomes (CI smoke test)
mcpb/manifest.json      Claude Desktop extension manifest (tools list, user_config → env)
.devcontainer/devcontainer.json  dev container (Node 22 + Bun); .github/workflows/devcontainer.yml builds and tests inside it
```

Request flow: a tool handler calls `prepareSource({ code | file })`, then `ModelService.getModel()`. On a cache miss that runs `engine.computeMesh()`, which uses OpenSCAD with `--backend=manifold` writing coloured OFF, then `parseOff()`. The resulting `Mesh` feeds stats, previews, the viewer and the mesh-based exporters, so one evaluation serves render, multiview, turntable, viewer and export.

## Conventions and constraints

- **ESM + Node16 resolution**: relative imports in TypeScript use `.js` extensions. Keep `strict` type-checking clean; tests are type-checked too.
- **`src/engine/wasm-worker.ts` must not import project modules** and must use only erasable TypeScript syntax (no enums, parameter properties, namespaces). Under tests it runs directly from `.ts` via Node's type stripping, so relative `.js` imports would fail.
- **One OpenSCAD WASM instance per job.** Emscripten's `callMain` can only run once per instance. Jobs run off the main thread; never call OpenSCAD synchronously on the main thread.
- **Camera math follows OpenSCAD.** The model-to-eye transform is `Rx(-rx)·Ry(-ry)·Rz(-rz)`, with Z up and the camera looking down -Z. The golden tests in `tests/rendering/` lock this down; if they fail, the renderer is wrong, not the test.
- **Colours**: OpenSCAD paints uncoloured faces `#F9D72C` and difference() cut faces `#9DCB51`. `isDefaultColor()` treats both as "no colour"; previews, stats, 3MF and the viewer depend on it.
- **Errors reach the model verbatim.** Classify OpenSCAD output in `engine/output.ts`. Throw `UserError` for bad tool input. Handlers are wrapped in `handle()` so failures (and oversized payloads) become `isError` results, never protocol errors. Add hints in `hintsFor()` (`server.ts`) rather than rewording OpenSCAD's messages.
- **Keep tool results small.** No multi-MB base64 payloads: clients built on the official MCP SDK drop stdio messages over 10 MB, and big payloads waste context. `export` writes files and returns a `resource_link`; inline embedding is opt-in (`embed`). Inline images and embedded files are capped at `MAX_INLINE_BYTES` (2 MiB); `render_turntable` streams frames into the APNG and stops as soon as it passes the cap (`TurntableTooLargeError`), so an oversized request never renders every frame. The cap exists because tmcp validates every result's base64 with a regex that overflows V8's stack at about 3.2 MiB, which would turn the result into a JSON-RPC error.
- **File safety**: `export` never overwrites unless `overwrite: true`, and the path extension must match the format. `read_scad_file` and `save_scad_file` only accept `.scad`. Relative paths resolve against the export folder, never the process cwd.
- **Viewer security**: it binds to `127.0.0.1`, checks the Host header on every request and the Origin on WebSocket and POST, and serves only the files of the built page, with three.js bundled in (no CDN). The page's CSP allows scripts and styles from `'self'` only, so the UI must not use inline `<script>`, `<style>` or `style="…"` attributes. Keep all of this when changing the viewer.
- **Viewer page** (`viewer/`): an npm workspace with its own devDependencies, including TypeScript 6, because svelte-check does not support the root's TypeScript 7 yet. The three.js code lives in `src/lib/scene.ts`; components drive it through `$effect`. If you change what the server sends (`encodeViewerMesh`, `updateMessage`, `GET /source/:version`), update `src/lib/mesh.ts` / `src/lib/protocol.ts`; `tests/viewer/viewer-ui.test.ts` round-trips the mesh format. The page connects its WebSocket to `/ws` (the server accepts any path), so the dev proxy can tell it apart from Vite's own. The WebGL canvas is transparent and the page paints the paper behind it, so the grid, edge and axis colours in `scene.ts` (`THEMES`) are matched to the tokens in `src/app.css`; change them together. Icons come from `@lucide/svelte` (import each icon from `@lucide/svelte/icons/<name>`); fonts are bundled from `@fontsource` packages, since the CSP only allows the page's own origin. Colours that vary per item (swatches) are SVG `fill` attributes, not inline styles.
- The package-root lookup in `paths.ts` matches the package name with a regex; update it if the package is renamed.

## Adding or changing a tool

1. Register it in `src/server.ts` with `server.tool({ name, title, description, schema: z.object({ … }), annotations }, handle(async (args) => …))`: zod fields with bounds, and `annotations` (`readOnlyHint`, `destructiveHint`, …). Tools without inputs omit `schema`. tmcp validates arguments before the handler runs and turns failures into `isError` results.
2. Model tools take `code` or `file` (`sourceShape`) plus `params` (`paramsSchema`), and go through `ModelService` so the cache is shared.
3. Update the `tools` list in `mcpb/manifest.json`, the Tools table in `README.md`, and the expected tool list in `tests/server.test.ts`.
4. Add MCP-level tests in `tests/server.test.ts`; they use a `@tmcp/transport-in-memory` session and the real WASM engine.

## Tests

- `tests/helpers/meshes.ts` (`box`, `lShape`) builds meshes without OpenSCAD; use it for renderer and geometry tests.
- WASM engine and server tests use the real bundled engine. Dispose engines and servers in `afterAll`.
- Never write to real user folders in tests. Pass a temp `outputDir` to `createServer` and an `openUrl` stub so no browser opens.
- The viewer server tests serve the built page from `dist/viewer-ui` (`pretest` builds it; build it yourself before running a single viewer test file with `npx vitest`). `tests/package-manifest.test.ts` rebuilds `dist/`, so `vitest.config.ts` puts it in its own project that runs after all the others.

## Assets and dependencies

- `assets/` is generated. OpenSCAD's official WebAssembly build (`assets/openscad/`: `openscad.mjs` glue + `openscad.wasm`) is the "web" zip from `files.openscad.org/snapshots`, pinned by snapshot date **and** SHA-256 in `scripts/fetch-assets.mjs`. Use the `-WebAssembly-web.zip`, not `-node.zip` (a CLI with host filesystem access that ignores `OPENSCADPATH`). Snapshots are pruned after some months, so bump the pin when it disappears. The newest day's snapshot can still be rebuilt under the same name, which changes its checksum, so pin one that is a few days old; snapshots from 2026.09 on have no AMF export. BOSL2 is pinned by tag **and** SHA-256 too; when bumping either, update both values. Fonts come from the `dejavu-fonts-ttf` devDependency. three.js is a devDependency of the `viewer/` workspace and is bundled into `dist/viewer-ui`, not copied into `assets/`; Vite writes the license texts of everything it bundles to `dist/viewer-ui/THIRD-PARTY-LICENSES.md` (`build.license`). The script skips work when `assets/manifest.json` matches.
- Runtime dependencies end up in the `.mcpb` bundle; keep them minimal. The MCP layer is [tmcp](https://tmcp.io) (`tmcp`, `@tmcp/transport-stdio`). Capabilities are declared explicitly in `createServer`; registering a tool or resource does not add one. Tool schemas go through `ZodInputSchemaAdapter` in `server.ts` (`z.toJSONSchema` with `io: "input"`, so no `additionalProperties: false`, as the MCP SDK sent them).
- **Known limitation**: `@tmcp/transport-stdio` handles a session's requests one at a time. A slow render delays `ping`, `tools/list` and any parallel tool calls until it finishes, and cancelling a request does not free the queue. Moving work into workers does not help (OpenSCAD already runs in a worker pool); the queue waits for each handler's result.
- `build-mcpb.sh` installs with `--omit=dev --omit=optional`: valibot (a tmcp dependency) has an optional peer on `typescript`, which npm would otherwise ship because it is also our devDependency.

## Releases

- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `perf:`, `docs:`, `ci:`, `build:`, `feat!:` / `BREAKING CHANGE:`). release-please reads them on `main`.
- **Do not edit versions by hand.** release-please manages `package.json`, `package-lock.json`, `mcpb/manifest.json` (via `extra-files`), `.release-please-manifest.json` and `CHANGELOG.md`.
- Merging the release PR tags `vX.Y.Z`. `.github/workflows/release.yml` then type-checks, tests, publishes to npm with trusted publishing (OIDC, provenance, no token), and uploads the `.mcpb` to the GitHub release. `package.json` `repository.url` must stay `git+https://github.com/khromov/simple-3d-modeling-mcp.git` (the repository kept its old name), or OIDC publishing fails.
- Keep these in sync: the npm version in `release.yml` and `tests/package-manifest.test.ts` (currently 12.2.2), and the Node range in `package.json` `engines` and `mcpb/manifest.json` `compatibility.runtimes.node`.
- CI (`.github/workflows/ci.yml`) runs Linux/macOS/Windows × Node 22/24/26 and × latest Bun (tests via `bun --bun vitest run`), each followed by a stdio smoke test with `scripts/capture-mcp-traffic.mjs`, plus an `.mcpb` build whose unzipped server gets the same smoke test. The Bun job skips `tests/package-manifest.test.ts`, which would run npm itself under Bun. Workflows on PRs opened by release-please need a manual "Approve and run".
