#!/usr/bin/env bash

set -euo pipefail

# Generic single-server deployment helper.
# Required:
#   SERVER=deploy@example.com
# Optional:
#   REMOTE_DIR=/var/www/pos-bar SERVER_NAME=pos.example.com SSH_PORT=22
#   CONFIGURE_NGINX=true

SERVER="${SERVER:-}"
REMOTE_DIR="${REMOTE_DIR:-/var/www/pos-bar}"
SERVER_NAME="${SERVER_NAME:-_}"
SSH_PORT="${SSH_PORT:-22}"
CONFIGURE_NGINX="${CONFIGURE_NGINX:-false}"

if [[ -z "$SERVER" ]]; then
  echo "Missing SERVER. Example:"
  echo "  SERVER=deploy@example.com SERVER_NAME=pos.example.com ./deploy.sh"
  exit 1
fi

if [[ ! -d frontend/dist ]]; then
  echo "Missing frontend/dist. Run: cd frontend && npm ci && npm run build"
  exit 1
fi

SSH=(ssh -p "$SSH_PORT" "$SERVER")
SCP=(scp -P "$SSH_PORT")

echo "=== Silver Lining POS deployment ==="
echo "Server:      $SERVER"
echo "Remote dir:  $REMOTE_DIR"
echo "Server name: $SERVER_NAME"

echo "[1/6] Create remote directories"
"${SSH[@]}" "mkdir -p '$REMOTE_DIR/backend/data' '$REMOTE_DIR/backend/routes' '$REMOTE_DIR/frontend/dist'"

echo "[2/6] Upload backend"
"${SCP[@]}" backend/app.py backend/requirements.txt backend/requirements.lock "$SERVER:$REMOTE_DIR/backend/"
"${SCP[@]}" backend/routes/*.py "$SERVER:$REMOTE_DIR/backend/routes/"
"${SCP[@]}" backend/data/*.json "$SERVER:$REMOTE_DIR/backend/data/"

echo "[3/6] Upload frontend build"
"${SCP[@]}" -r frontend/dist/. "$SERVER:$REMOTE_DIR/frontend/dist/"

echo "[4/6] Install locked Python dependencies"
"${SSH[@]}" "python3 -m venv '$REMOTE_DIR/.venv' && '$REMOTE_DIR/.venv/bin/python' -m pip install -r '$REMOTE_DIR/backend/requirements.lock'"

if [[ "$CONFIGURE_NGINX" == "true" ]]; then
  echo "[5/6] Configure Nginx"
  "${SSH[@]}" "sudo tee /etc/nginx/sites-available/pos-bar >/dev/null <<'EOF'
server {
    listen 80;
    server_name $SERVER_NAME;

    location / {
        root $REMOTE_DIR/frontend/dist;
        try_files \$uri \$uri/ /index.html;
    }

    location /api {
        proxy_pass http://127.0.0.1:27779;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
sudo ln -sf /etc/nginx/sites-available/pos-bar /etc/nginx/sites-enabled/pos-bar
sudo nginx -t
sudo systemctl reload nginx"
else
  echo "[5/6] Skip Nginx (set CONFIGURE_NGINX=true to enable)"
fi

echo "[6/6] Start backend demo process"
"${SSH[@]}" "pkill -f '$REMOTE_DIR/backend/app.py' 2>/dev/null || true; cd '$REMOTE_DIR/backend' && nohup '$REMOTE_DIR/.venv/bin/python' app.py > '$REMOTE_DIR/backend.log' 2>&1 &"

echo "Deployment finished."
echo "Important: backend/app.py uses Flask's development server."
echo "For public production use, add authentication, HTTPS and a production WSGI service."
