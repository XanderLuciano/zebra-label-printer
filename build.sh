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
#
# This step replaces $DIST wholesale, and older installs kept the SQLite database
# inside it (install.sh pointed ZEBRA_DB_PATH at dist-zebra/data). That meant every
# rebuild — including every update — deleted the print history, the server printer
# configuration, and the settings. Rescue an existing data/ before the wipe and put
# it back afterwards, so upgrading from such an install doesn't lose anything.
echo "📁 Assembling $DIST..."

RESCUED_DATA=""
if [ -d "$DIST/data" ] && [ -n "$(ls -A "$DIST/data" 2>/dev/null)" ]; then
  RESCUED_DATA="$(mktemp -d)"
  # -a keeps the -wal and -shm sidecars intact, which WAL mode needs to stay consistent.
  cp -a "$DIST/data/." "$RESCUED_DATA/"
  echo "   ↳ preserving existing database from $DIST/data"
  # Between the rm -rf below and the restore, the only copy of the database
  # lives in an unadvertised temp dir. If we die in that window, print where
  # it is so the data stays recoverable.
  trap '[ -n "$RESCUED_DATA" ] && echo "⚠ build interrupted — rescued database preserved at: $RESCUED_DATA" >&2' EXIT
  trap 'exit 130' INT TERM
fi

rm -rf "$DIST"
mkdir -p "$DIST/data"

if [ -n "$RESCUED_DATA" ]; then
  cp -a "$RESCUED_DATA/." "$DIST/data/"
  rm -rf "$RESCUED_DATA"
  RESCUED_DATA=""
  trap - EXIT INT TERM
fi

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
