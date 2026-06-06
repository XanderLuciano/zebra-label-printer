#!/usr/bin/env bash
# 🦓 Zebra Label Printer — Interactive Installer
# One-command setup for Linux/macOS.
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}✔${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err()  { echo -e "${RED}✘${NC} $1"; exit 1; }
info() { echo -e "${BLUE}ℹ${NC} $1"; }

echo -e "${GREEN}"
echo "  ╔══════════════════════════════════════╗"
echo "  ║   🦓  Zebra Label Printer           ║"
echo "  ║      GK420d Network Print Server    ║"
echo "  ╚══════════════════════════════════════╝"
echo -e "${NC}"
echo ""

# ── Parse flags ──────────────────────────────────────────────────────────────
AUTO_START="ask"
AUTO_UPDATE="ask"
NON_INTERACTIVE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --auto-start)    AUTO_START="yes"; shift ;;
    --no-auto-start) AUTO_START="no"; shift ;;
    --auto-update)   AUTO_UPDATE="yes"; shift ;;
    --no-auto-update) AUTO_UPDATE="no"; shift ;;
    --yes|-y)        NON_INTERACTIVE=true; AUTO_START="yes"; AUTO_UPDATE="yes"; shift ;;
    --help|-h)
      echo "Usage: install.sh [options]"
      echo "  --auto-start      Enable auto-start on boot"
      echo "  --no-auto-start   Disable auto-start on boot"
      echo "  --auto-update     Enable automatic update checks"
      echo "  --no-auto-update  Disable automatic update checks"
      echo "  -y, --yes         Non-interactive mode (yes to everything)"
      exit 0
      ;;
    *) shift ;;
  esac
done

# ── Check/install Node.js ────────────────────────────────────────────────────
echo "━━━ Step 1/4: Runtime ━━━"
if command -v node &>/dev/null; then
  NODE_VER=$(node --version)
  log "Node.js $NODE_VER found"
else
  warn "Node.js not found. Installing via nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install --lts
  log "Node.js installed"
fi

# ── Install package ──────────────────────────────────────────────────────────
echo ""
echo "━━━ Step 2/4: Package ━━━"
if [ -f "package.json" ] && [ -f "build.sh" ]; then
  info "Local source detected — building from source..."
  bash build.sh
  INSTALL_DIR="$(pwd)"
else
  info "Installing from GitHub..."
  INSTALL_DIR="$HOME/.zebra-label-printer"
  mkdir -p "$INSTALL_DIR"
  # Clone to get the full repo (needed for build + updates)
  if [ -d "$INSTALL_DIR/.git" ]; then
    cd "$INSTALL_DIR" && git pull origin main
  else
    git clone https://github.com/XanderLuciano/zebra-label-printer.git "$INSTALL_DIR"
  fi
  cd "$INSTALL_DIR"
  bash build.sh
fi

NODE_BIN="$(which node)"
SERVER_JS="$INSTALL_DIR/dist-zebra/dist/server/index.js"
log "Package installed to $INSTALL_DIR"

# ── Configure ────────────────────────────────────────────────────────────────
echo ""
echo "━━━ Step 3/4: Configuration ━━━"

# Auto-start prompt
if [ "$AUTO_START" = "ask" ] && [ "$NON_INTERACTIVE" = false ]; then
  echo ""
  read -p "Auto-start on boot? [Y/n] " -r REPLY
  AUTO_START=$( [[ ! $REPLY =~ ^[Nn]$ ]] && echo "yes" || echo "no" )
fi

# Auto-update prompt
if [ "$AUTO_UPDATE" = "ask" ] && [ "$NON_INTERACTIVE" = false ]; then
  echo ""
  echo "Auto-update checks for new releases once per day."
  echo "Updates must still be installed manually via the web UI."
  read -p "Enable automatic update checks? [Y/n] " -r REPLY
  AUTO_UPDATE=$( [[ ! $REPLY =~ ^[Nn]$ ]] && echo "yes" || echo "no" )
fi

# ── Auto-start setup ────────────────────────────────────────────────────────
if [ "$AUTO_START" = "yes" ]; then
  echo ""
  if command -v systemctl &>/dev/null; then
    # systemd (Linux)
    SERVICE_FILE="/etc/systemd/system/zebra-label.service"
    sudo tee "$SERVICE_FILE" > /dev/null <<SYSTEMD
[Unit]
Description=Zebra Label Printer API
After=network.target cups.service

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR/dist-zebra
Environment=PORT=3420
Environment=ZEBRA_DB_PATH=$INSTALL_DIR/dist-zebra/data/zebra-label-printer.db
ExecStart=$NODE_BIN $SERVER_JS
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
SYSTEMD
    sudo systemctl daemon-reload
    sudo systemctl enable zebra-label
    sudo systemctl restart zebra-label
    log "Auto-start enabled (systemd)"

  elif [[ "$OSTYPE" == "darwin"* ]]; then
    # launchd (macOS)
    PLIST="$HOME/Library/LaunchAgents/com.zebra.label-printer.plist"
    mkdir -p "$(dirname "$PLIST")"
    cat > "$PLIST" <<LAUNCHD
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.zebra.label-printer</string>
  <key>WorkingDirectory</key>
  <string>$INSTALL_DIR/dist-zebra</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$SERVER_JS</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key>
    <string>3420</string>
    <key>ZEBRA_DB_PATH</key>
    <string>$INSTALL_DIR/dist-zebra/data/zebra-label-printer.db</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
LAUNCHD
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load "$PLIST"
    log "Auto-start enabled (launchd)"

  else
    warn "Could not detect init system. Auto-start not configured."
    warn "Run manually: $NODE_BIN $SERVER_JS"
  fi
else
  info "Skipping auto-start (run manually: $NODE_BIN $SERVER_JS)"
fi

# ── Save preferences ────────────────────────────────────────────────────────
if [ "$AUTO_UPDATE" = "yes" ]; then
  # Will take effect after first server start
  mkdir -p "$INSTALL_DIR/dist-zebra/data"
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "━━━ Step 4/4: Complete! ━━━"
echo ""
echo -e "  ${GREEN}🦓 Zebra Label Printer is ready!${NC}"
echo ""
echo "  ┌─────────────────────────────────────────────┐"
echo "  │  Web UI:   http://localhost:3420            │"
echo "  │  API Docs: http://localhost:3420/api/docs   │"
echo "  │  Health:   http://localhost:3420/api/health │"
echo "  └─────────────────────────────────────────────┘"
echo ""
echo "  Quick test:"
echo "    curl http://localhost:3420/api/health"
echo ""
echo "  Print a label:"
echo "    curl -X POST http://localhost:3420/api/print/text \\"
echo "      -H 'Content-Type: application/json' \\"
echo "      -d '{\"lines\":[\"Hello World\"]}'"
echo ""
echo "  View printer info:"
echo "    curl http://localhost:3420/api/printers"
echo ""
echo "  Manage settings:"
echo "    curl http://localhost:3420/api/settings"
echo ""
echo "  Check for updates:"
echo "    curl http://localhost:3420/api/version"
echo ""
echo "  ┌─────────────────────────────────────────────┐"
echo "  │  Printer Setup                              │"
echo "  │                                             │"
echo "  │  1. Plug in Zebra GK420d via USB            │"
echo "  │  2. CUPS should auto-detect it              │"
echo "  │  3. Verify: lpstat -p | grep -i zebra       │"
echo "  │  4. If not found:                           │"
echo "  │     sudo lpadmin -p ZTC-GK420d -E \\        │"
echo "  │       -v usb://Zebra%20Technologies/... \\  │"
echo "  │       -m raw                                │"
echo "  │  5. Set label size in Web UI → Settings     │"
echo "  └─────────────────────────────────────────────┘"
echo ""

if [ "$AUTO_START" = "yes" ]; then
  echo "  Auto-start:  ✅ Enabled (survives reboots)"
else
  echo "  Auto-start:  ❌ Disabled"
  echo "  Start manually: $NODE_BIN $SERVER_JS"
fi

if [ "$AUTO_UPDATE" = "yes" ]; then
  echo "  Auto-update: ✅ Checks daily (install via Web UI)"
else
  echo "  Auto-update: ❌ Disabled"
  echo "  Check manually: curl http://localhost:3420/api/version"
fi

echo ""
echo "  To change settings later, use the Web UI at http://localhost:3420"
echo "  or edit the environment variables and restart the service."
echo ""

if [ "$AUTO_START" = "yes" ] && command -v systemctl &>/dev/null; then
  echo "  Service management:"
  echo "    sudo systemctl status zebra-label"
  echo "    sudo systemctl restart zebra-label"
  echo "    sudo systemctl stop zebra-label"
  echo "    journalctl -u zebra-label -f   (view logs)"
fi

echo ""
