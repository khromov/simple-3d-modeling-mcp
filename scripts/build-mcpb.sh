#!/bin/bash
set -euo pipefail

# Build the .mcpb Desktop Extension for Claude Desktop.
# Usage: ./scripts/build-mcpb.sh
#
# Bundle layout (mirrors the npm package so runtime path lookups are identical):
#   manifest.json
#   server/package.json
#   server/dist/…            compiled server
#   server/assets/…          fonts + BOSL2 for the WASM engine
#   server/node_modules/…    production dependencies

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/mcpb-build"
MCPB_DIR="$PROJECT_DIR/mcpb"
OUTPUT="$PROJECT_DIR/simple-3d-modeling.mcpb"

echo "=== Building .mcpb Desktop Extension ==="

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/server"

echo "→ Compiling TypeScript (and fetching assets)..."
cd "$PROJECT_DIR"
npm run build

echo "→ Copying server files..."
cp -r "$PROJECT_DIR/dist" "$BUILD_DIR/server/dist"
cp -r "$PROJECT_DIR/assets" "$BUILD_DIR/server/assets"
cp "$PROJECT_DIR/package.json" "$PROJECT_DIR/package-lock.json" "$PROJECT_DIR/LICENSE" "$BUILD_DIR/server/"

echo "→ Installing production dependencies..."
cd "$BUILD_DIR/server"
# --omit=optional as well: valibot (via tmcp) has an optional peer dependency on
# typescript, and because typescript is also our devDependency npm marks it
# "devOptional", which --omit=dev alone keeps (~30 MB with the native binary).
npm ci --omit=dev --omit=optional --ignore-scripts
cd "$PROJECT_DIR"

echo "→ Writing manifest..."
VERSION=$(node -p "require('./package.json').version")
node -e "
const m = require('$MCPB_DIR/manifest.json');
m.version = '$VERSION';
process.stdout.write(JSON.stringify(m, null, 2) + '\n');
" > "$BUILD_DIR/manifest.json"

echo "→ Packing .mcpb bundle..."
npx --yes @anthropic-ai/mcpb pack "$BUILD_DIR" "$OUTPUT"

rm -rf "$BUILD_DIR"

echo ""
echo "=== Done! ==="
echo "Output: $OUTPUT"
echo "Size: $(du -h "$OUTPUT" | cut -f1)"
echo ""
echo "To verify: npx @anthropic-ai/mcpb info $OUTPUT"
