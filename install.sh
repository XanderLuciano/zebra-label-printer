#!/usr/bin/env bash
# zebra-label-printer install script
# One-command setup for Linux/macOS. Installs Node.js if needed,
# globally installs the package, and configures auto-start on boot.
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}✔${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err()  { echo -e "${RED}✘${NC} $1"; exit 1; }

echo "🦓 Zebra Label Printer — Installer"
echo "=================================="
echo ""

# ── Check/install Node.js ────────────────────────────────────────────────────
if command -v node &>/dev/null; then
  NODE_VER=$(node --version | sed 's/v//')
  log "Node.js $NODE_VER found"
else
  warn "Node.js not found. Installing via nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install --lts
  log "Node.js installed"
fi

# ── Install package globally ──────────────────────────────────────────────────
echo ""
echo "Installing zebra-label-printer..."
if [ -f "package.json" ]; then
  # Local directory install
  npm install -g .
else
  # Remote install from GitHub
  npm install -g github:XanderLuciano/zebra-label-printer
fi
log "Package installed"
log "CLI: $(which zebra-label)"

# ── Auto-start setup ─────────────────────────────────────────────────────────
echo ""
echo "Configuring auto-start..."

if command -v systemctl &>/dev/null; then
  # systemd (Linux)
  SERVICE_FILE="/etc/systemd/system/zebra-label.service"

  if [ ! -f "$SERVICE_FILE" ]; then
    sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=Zebra Label Printer API
After=network.target

[Service]
Type=simple
User=$USER
Environment=PORT=3420
Environment=ZEBRA_DB_PATH=$HOME/.zebra-label/data/zebra-label-printer.db
ExecStart=$(which node) $(npm root -g)/zebra-label-printer/dist/server/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
    sudo systemctl daemon-reload
    sudo systemctl enable zebra-label
    sudo systemctl start zebra-label
    log "systemd service created and started"
  else
    log "systemd service already exists"
  fi

elif [[ "$OSTYPE" == "darwin"* ]]; then
  # launchd (macOS)
  PLIST="$HOME/Library/LaunchAgents/com.zebra.label-printer.plist"

  if [ ! -f "$PLIST" ]; then
    mkdir -p "$(dirname "$PLIST")"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.zebra.label-printer</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(which node)</string>
    <string>$(npm root -g)/zebra-label-printer/dist/server/index.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key>
    <string>3420</string>
    <key>ZEBRA_DB_PATH</key>
    <string>$HOME/.zebra-label/data/zebra-label-printer.db</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
EOF
    launchctl load "$PLIST"
    log "launchd service created and started"
  else
    log "launchd service already exists"
  fi

else
  warn "Could not detect init system. Auto-start not configured."
  warn "Run manually: zebra-label serve"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "🎉 Installation complete!"
echo ""
echo "   API:      http://localhost:3420"
echo "   Docs:     http://localhost:3420/api/docs"
echo "   Web UI:   cd web && npm run dev  (or use the standalone API)"
echo ""
echo "   Test:     curl http://localhost:3420/api/health"
echo "   Print:    curl -X POST http://localhost:3420/api/print/text -H 'Content-Type: application/json' -d '{\"lines\":[\"Hello!\"]}'"
echo ""
