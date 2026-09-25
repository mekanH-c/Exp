#!/usr/bin/env bash
set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"

echo "[1/4] Updating repository from GitHub..."
git fetch origin main
git reset --hard origin/main

if [ -f "$APP_DIR/venv/bin/python" ]; then
    PY_BIN="$APP_DIR/venv/bin/python"
elif [ -f "$APP_DIR/.venv/bin/python" ]; then
    PY_BIN="$APP_DIR/.venv/bin/python"
else
    PY_BIN="$(which python3)"
fi
echo "Using Python: $PY_BIN"

echo "[2/4] Freeing Port 80..."
sudo systemctl stop nginx 2>/dev/null || true
sudo systemctl disable nginx 2>/dev/null || true
sudo pkill -f uvicorn 2>/dev/null || true

echo "[3/4] Installing systemd service (aquag.service) on Port 80..."
sudo bash -c "cat > /etc/systemd/system/aquag.service" <<EOF
[Unit]
Description=AquaG Flood Intelligence Server
After=network.target

[Service]
User=ubuntu
WorkingDirectory=$APP_DIR
Environment="PATH=$APP_DIR/venv/bin:$APP_DIR/.venv/bin:/home/ubuntu/.local/bin:/usr/local/bin:/usr/bin:/bin"
AmbientCapabilities=CAP_NET_BIND_SERVICE
ExecStart=$PY_BIN -m uvicorn backend.main:app --host 0.0.0.0 --port 80
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

echo "[4/4] Starting AquaG service..."
sudo systemctl daemon-reload
sudo systemctl enable aquag
sudo systemctl restart aquag
sleep 3
sudo systemctl status aquag --no-pager
