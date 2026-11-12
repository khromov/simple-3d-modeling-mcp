# Sketchpad 3D

[![npm version](https://img.shields.io/npm/v/sketchpad-3d-model-mcp)](https://www.npmjs.com/package/sketchpad-3d-model-mcp)
[![npm provenance](https://img.shields.io/badge/npm-provenance-blue)](https://www.npmjs.com/package/sketchpad-3d-model-mcp#provenance)
[![CI](https://github.com/khromov/simple-3d-modeling-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/khromov/simple-3d-modeling-mcp/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/khromov/simple-3d-modeling-mcp/badge)](https://scorecard.dev/viewer/?uri=github.com/khromov/simple-3d-modeling-mcp)
[![CodeQL](https://github.com/khromov/simple-3d-modeling-mcp/actions/workflows/codeql.yml/badge.svg)](https://github.com/khromov/simple-3d-modeling-mcp/actions/workflows/codeql.yml)
[![License: GPL-2.0](https://img.shields.io/badge/License-GPL--2.0-green.svg)](https://opensource.org/licenses/GPL-2.0)

[![Install with Claude Desktop](https://img.shields.io/badge/Install%20with-Claude%20Desktop-orange?style=for-the-badge&logo=claude)](https://github.com/khromov/simple-3d-modeling-mcp/releases/latest/download/sketchpad-3d.mcpb)

An MCP (Model Context Protocol) server that lets anyone create, iterate on, and export 3D models through natural conversation with an LLM. Works with **any MCP-compatible client** — Claude, ChatGPT, Codex, and more. **Zero setup** — OpenSCAD is bundled via WebAssembly, together with the BOSL2 library and fonts.

Published on npm as `sketchpad-3d-model-mcp` (formerly `@khromov/simple-3d-modeling-mcp`). Based on [mazzanfar/simple-3d-modeling-mcp](https://github.com/mazzanfar/simple-3d-modeling-mcp).

## Features

- **Zero setup** — `npx sketchpad-3d-model-mcp` and go. No OpenSCAD install, no PATH configuration.
- **Fast** — uses OpenSCAD's Manifold geometry backend; booleans that took over a minute with CGAL finish in well under a second. Repeat renders of the same code are cached.
- **Previews the model can reason about** — every render returns the image *and* the model's size, bounds, volume, triangle count, `echo()` output and warnings, so the AI can check “is it really 80 mm wide?”.
- **Real error messages** — OpenSCAD's own errors (with line numbers) plus hints, so the AI can fix its code.
- **Multi-view grids** — labelled front / right / top (orthographic) + perspective views in one image.
- **Turntable animations** — 360° animated previews for the user.
- **Colours** — `color()` shows up in previews, the viewer and 3MF exports.
- **BOSL2 and `text()`** — `include <BOSL2/std.scad>` and `text("…")` work out of the box.
- **Live browser viewer** — rotate/zoom/pan, model history, dimensions, STL/3MF download, open in your slicer. Runs locally, works offline.
- **Real files** — export STL, 3MF, OBJ, OFF (and SVG/DXF for 2D designs) to a folder you choose; save and render `.scad` files with relative `include`/`use`.

## Quick Start

This server speaks the standard [Model Context Protocol](https://modelcontextprotocol.io) over **stdio**, so it works with any MCP-compatible client.

### Claude Desktop

**Easiest:** download [sketchpad-3d.mcpb](https://github.com/khromov/simple-3d-modeling-mcp/releases/latest/download/sketchpad-3d.mcpb) and double-click it. The extension settings let you pick the export folder or turn off the automatic browser viewer.

Or add it to `claude_desktop_config.json` manually:

```json
{
  "mcpServers": {
    "sketchpad-3d": {
      "command": "npx",
      "args": ["-y", "sketchpad-3d-model-mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add sketchpad-3d -- npx -y sketchpad-3d-model-mcp
```

### ChatGPT Desktop (macOS)

Go to **Settings → MCP Servers → Add Server**, then enter:

- **Name:** `sketchpad-3d`
- **Command:** `npx -y sketchpad-3d-model-mcp`

### OpenAI Codex CLI

```bash
codex mcp add sketchpad-3d -- npx -y sketchpad-3d-model-mcp
```

### Other MCP Clients (Cursor, Windsurf, etc.)

Any client that supports MCP over stdio can use this server:

```bash
npx -y sketchpad-3d-model-mcp
```

Requires Node.js 22, 24 or 26 (LTS).

## Tools

| Tool | Description |
|------|-------------|
| `render` | Render code or a `.scad` file to a PNG preview, with size/bounds/volume, `echo()` output and warnings. Views: `front`, `back`, `left`, `right`, `top`, `bottom`, `iso`, rotation angles, or an OpenSCAD camera string. |
| `render_multiview` | Labelled grid of views (default: front, right, top in orthographic + perspective) |
| `render_turntable` | 360° turntable animation (animated PNG) |
| `export` | Export to STL, 3MF (with colours), OBJ, OFF, SVG, DXF or CSG on disk. Never overwrites unless asked. |
| `validate` | Fast check for syntax errors, failed `assert()`s and unknown variables |
| `open_viewer` | Open the interactive 3D viewer in the browser |
| `save_scad_file` | Save OpenSCAD source to a `.scad` file |
| `read_scad_file` | Read a `.scad` file |
| `list_libraries` | Bundled libraries (BOSL2) |
| `cheatsheet` | OpenSCAD + BOSL2 quick reference (also available as the `openscad://cheatsheet` resource) |
| `get_version` | Engine, OpenSCAD version, backend and settings |

All model tools accept either `code` or `file` (an absolute path to a `.scad` file; relative `include`/`use`/`import` paths resolve from its folder), plus `params` for variable overrides (like OpenSCAD's `-D`), e.g. `{"width": 40, "size": [10, 20, 5]}`.

A render response looks like this (plus the image):

```text
Size: 80 × 45 × 62.5 mm (X × Y × Z)
Bounds: X -40 … 40 · Y -22.5 … 22.5 · Z 0 … 62.5
Volume: 41.27 cm³ · Surface: 210.33 cm² · 1,536 triangles

Geometry evaluated in 0.31s.

ECHO output:
"lip height", 12

Interactive viewer: http://localhost:51386
```

## Live Browser Viewer

On the first render an interactive viewer opens in your browser (set `OPENSCAD_AUTO_OPEN_VIEWER=false` to only print its URL):

- **Live updates** — refreshes on every render; your camera position is kept while you iterate
- **History** — every version, named after the render's `title`
- **Dimensions** — size, true volume and triangle count
- **Code** — the OpenSCAD source of each version, read-only, with syntax highlighting, `-D` overrides, copy and a full-screen view
- **Colours** — `color()` is shown; preset swatches or a colour picker set the colour of uncoloured parts
- **Export** — download STL or 3MF, or open the model in Bambu Studio, OrcaSlicer, PrusaSlicer, Cura or Creality Print (sent as a 3MF, so Bambu Studio 2.5+ maps its colours to filaments)
- **Controls** — rotate (drag), zoom (scroll), pan (right- or middle-drag), edges, wireframe, auto-rotate, grid
- **Themes** — a light "drawing on paper" theme and a dark blueprint theme; follows your OS setting until you pick one

The viewer listens on `127.0.0.1` only and rejects requests from other web pages (Host and Origin checks).

## Exports

`export` writes to the `path` you give (absolute, or `~/…`), or to the export folder (default: `~/Downloads`, configurable). If a file already exists, a numbered name is used unless `overwrite: true`. The format can come from the path's extension (`~/Desktop/stand.3mf`). Exports reuse the geometry from the last render of the same code, so they are near-instant.

## Engine

OpenSCAD runs as its official WebAssembly build (a pinned nightly snapshot) with Manifold, BOSL2 and DejaVu fonts (Liberation Sans maps to DejaVu Sans). Each job runs in a worker thread with a timeout, and previews come from the built-in renderer. An installed OpenSCAD is never used. `get_version` shows the OpenSCAD version and settings.

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENSCAD_OUTPUT_DIR` | Folder for exports and relative `save_scad_file` paths | `~/Downloads` |
| `OPENSCAD_AUTO_OPEN_VIEWER` | Open the browser viewer on the first render | `true` |
| `OPENSCAD_TIMEOUT` | Seconds before a single OpenSCAD run is stopped | `120` |

`OPENSCAD_ENGINE`, `OPENSCAD_PATH` and `OPENSCAD_WORK_DIR` from older versions are ignored, with a warning in `get_version`.

## Compatibility Notes

| Client | Inline Image Previews | Export / Validate / Viewer |
|--------|----------------------|---------------------------|
| Claude Desktop | Yes | Yes |
| Claude Code | Yes | Yes |
| ChatGPT Desktop | Yes | Yes |
| OpenAI Codex CLI | Depends on terminal | Yes |
| Cursor / Windsurf | Yes | Yes |

> **Tip:** even if a client doesn't render inline images, the AI still gets the dimensions, and the browser viewer (`open_viewer`) works everywhere.

## Example Conversation

> **You:** Make me a phone stand that holds the phone at 60 degrees
>
> **AI:** *calls render* — Here's a phone stand with a 60° viewing angle. It's 80 × 70 × 62 mm with a 12 mm lip. The 3D viewer is open in your browser too. Want me to adjust anything?
>
> **You:** Make it thicker and add a cable slot in the back
>
> **AI:** *modifies code, calls render_multiview* — Updated: walls are now 4 mm and there's a 12 mm cable slot, visible in the back view.
>
> **You:** Perfect! Export it for my Bambu printer
>
> **AI:** *calls export(format="3mf", title="phone stand")* — Saved to ~/Downloads/phone-stand.3mf (42 KB). You can also open it in Bambu Studio from the viewer.

## Development

```bash
npm install
npm run build        # fetches bundled assets (OpenSCAD WASM, fonts, BOSL2), builds the viewer page and compiles TypeScript
npm test             # unit, engine, renderer, viewer and MCP-level tests
npm run typecheck    # sources, tests and the viewer (svelte-check)
npm run dev          # watch mode
npm run dev:viewer   # viewer UI with hot reload, against sample models
npm run build:mcpb   # Claude Desktop extension bundle
```

`npm run assets` populates `assets/` (git-ignored): OpenSCAD's WebAssembly build and BOSL2, both downloaded at pinned versions and verified against SHA-256 checksums, and DejaVu fonts from the `dejavu-fonts-ttf` package.

The browser viewer is a Vite + Svelte 5 app in `viewer/` (an npm workspace). `npm run build` bundles it, three.js included, into `dist/viewer-ui`, which the server serves locally.

### Releasing

Releases are automated with [release-please](https://github.com/googleapis/release-please). Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `feat!:` …) on `main`; release-please keeps a release PR open with the next version and changelog. Merging it tags the release, publishes to npm with [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC, with provenance — no npm token is stored), and attaches `sketchpad-3d.mcpb` to the GitHub release.

## License

GPL-2.0 (required by the bundled OpenSCAD). Bundled third-party assets keep their own licenses, included alongside them: OpenSCAD's WebAssembly build (GPL, see [openscad/openscad](https://github.com/openscad/openscad)), BOSL2 (BSD-2-Clause), DejaVu fonts (Bitstream Vera / public domain). The viewer page bundles three.js and Svelte (MIT), Lucide icons (ISC) and the Jost and IBM Plex Mono fonts (OFL-1.1); their license texts ship in `dist/viewer-ui/THIRD-PARTY-LICENSES.md`.
