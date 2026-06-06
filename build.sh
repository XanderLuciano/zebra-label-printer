#!/usr/bin/env bash
# Build script — produces a self-contained distributable in dist-zebra/
# Run: bash build.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$ROOT/dist-zebra"

echo "🦓 Building zebra-label-printer..."
echo ""

# 1. Build the TypeScript library + API server
echo "📦 Building backend..."
cd "$ROOT"
npm ci --include=dev
npm run build

# 2. Build the Nuxt web UI (SPA mode)
echo "🎨 Building web UI (SPA)..."
cd "$ROOT/web"
npm ci --include=dev
npx nuxt build

# 3. Capture SPA index.html from Nitro
echo "📄 Capturing SPA shell..."
cd "$ROOT/web"
PORT=19999 node .output/server/index.mjs &
NITRO_PID=$!
sleep 2
curl -s http://localhost:19999 > .output/public/index.html
kill $NITRO_PID 2>/dev/null || true
wait $NITRO_PID 2>/dev/null || true

# 4. Assemble distributable
echo "📁 Assembling $DIST..."
rm -rf "$DIST"
mkdir -p "$DIST/data"

# Backend JS
cp -r "$ROOT/dist" "$DIST/dist"

# Drizzle migrations (needed at runtime for auto-migration)
cp -r "$ROOT/drizzle" "$DIST/drizzle"

# Web UI static files
cp -r "$ROOT/web/.output/public" "$DIST/public"

# Package files
cp "$ROOT/package.json" "$DIST/package.json"
cp "$ROOT/package-lock.json" "$DIST/package-lock.json"

# Install script
cp "$ROOT/install.sh" "$DIST/install.sh"
chmod +x "$DIST/install.sh"

echo ""
echo "✅ Build complete: $DIST"
echo ""
echo "To run:"
echo "  cd $DIST && npm ci --omit=dev && node dist/server/index.js"
echo ""
echo "Or use the install script:"
echo "  bash $DIST/install.sh"
