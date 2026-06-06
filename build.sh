#!/usr/bin/env bash
# Build script — produces a self-contained distributable in dist-zebra/
# Run: bash build.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$ROOT/dist-zebra"

# Ensure NODE_ENV doesn't interfere with dependency installation.
# Build needs devDependencies (typescript, drizzle-kit); we set production
# explicitly only when pruning deps for the final runtime bundle.
unset NODE_ENV

echo "🦓 Building zebra-label-printer..."
echo ""

# 1. Build the TypeScript library + API server
echo "📦 Building backend..."
cd "$ROOT"
npm ci
npm run build

# 2. Build the Nuxt web UI (SPA mode)
echo "🎨 Building web UI (SPA)..."
cd "$ROOT/web"
npm ci
npx nuxt build

# 3. Capture SPA index.html from Nitro
echo "📄 Capturing SPA shell..."
cd "$ROOT/web"
PORT=19999 node .output/server/index.mjs &
NITRO_PID=$!
# Wait for Nitro to be ready (up to 10s)
for i in $(seq 1 20); do
  if curl -s -o /dev/null http://localhost:19999 2>/dev/null; then
    break
  fi
  sleep 0.5
done
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

# Install production-only runtime deps
echo "📦 Installing production dependencies in dist..."
cd "$DIST"
NODE_ENV=production npm ci --omit=dev

echo ""
echo "✅ Build complete: $DIST"
echo ""
echo "To run:"
echo "  cd $DIST && node dist/server/index.js"
echo ""
echo "Or use the install script:"
echo "  bash $DIST/install.sh"
