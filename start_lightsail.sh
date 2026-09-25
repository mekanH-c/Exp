#!/usr/bin/env bash
set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"

echo "[1/5] Updating repository from GitHub..."
git fetch origin main
git reset --hard origin/main

echo "[2/5] Locating Python environment with FastAPI & Uvicorn..."
PY_BIN=""
for candidate in \
    "$APP_DIR/venv/bin/python" \
    "$APP_DIR/.venv/bin/python" \
    "$APP_DIR/env/bin/python" \
    "$HOME/venv/bin/python" \
    "$HOME/.venv/bin/python" \
    "$HOME/env/bin/python" \
    $(find /home/ubuntu -maxdepth 3 -name "uvicorn" 2>/dev/null | sed 's|/uvicorn$|/python|') \
    "$(which python3)"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ] && "$candidate" -c "import uvicorn, fastapi" 2>/dev/null; then
        PY_BIN="$candidate"
        break
    fi
done

if [ -z "$PY_BIN" ]; then
    echo "Installing dependencies into virtual environment..."
    python3 -m venv "$APP_DIR/.venv" || sudo apt-get update && sudo apt-get install -y python3-venv && python3 -m venv "$APP_DIR/.venv"
    "$APP_DIR/.venv/bin/pip" install --upgrade pip
    "$APP_DIR/.venv/bin/pip" install -r requirements.txt
    PY_BIN="$APP_DIR/.venv/bin/python"
fi

echo "Using verified Python: $PY_BIN"
USER_SITE="$("$PY_BIN" -c 'import site; print(":".join(site.getsitepackages() + [site.getusersitepackages()]))' 2>/dev/null || true)"

echo "[3/5] Freeing Port 80..."
sudo systemctl stop nginx 2>/dev/null || true
sudo systemctl disable nginx 2>/dev/null || true
sudo pkill -f uvicorn 2>/dev/null || true
sudo fuser -k 80/tcp 2>/dev/null || true

echo "[4/5] Configuring systemd service (aquag.service) on Port 80..."
sudo bash -c "cat > /etc/systemd/system/aquag.service" <<EOF
[Unit]
Description=AquaG Flood Intelligence Server
After=network.target

[Service]
User=root
WorkingDirectory=$APP_DIR
Environment="HOME=/home/ubuntu"
Environment="PYTHONPATH=$APP_DIR:$USER_SITE"
Environment="PATH=$(dirname "$PY_BIN"):/home/ubuntu/.local/bin:/usr/local/bin:/usr/bin:/bin"
ExecStart=$PY_BIN -m uvicorn backend.main:app --host 0.0.0.0 --port 80
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

echo "[5/5] Starting AquaG service on Port 80..."
sudo systemctl daemon-reload
sudo systemctl enable aquag
sudo systemctl restart aquag

echo "Waiting for server to initialize..."
for i in 1 2 3 4 5 6 7 8; do
    sleep 2
    if curl -s http://127.0.0.1/health | grep -q '"status":"ok"'; then
        echo "===================================================="
        echo "SUCCESS! AquaG Server is LIVE and healthy on Port 80!"
        echo "===================================================="
        sudo systemctl status aquag --no-pager | head -n 12
        exit 0
    fi
done

echo "Service did not respond yet. Checking logs:"
sudo journalctl -u aquag -n 30 --no-pager
