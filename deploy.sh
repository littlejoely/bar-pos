#!/usr/bin/env bash

set -euo pipefail

# Silver Lining POS single-server deployment.
# Required: SERVER=deploy@example.com
# Optional: SSH_PORT=22 DEPLOY_DATA=false

SERVER="${SERVER:-}"
SSH_PORT="${SSH_PORT:-22}"
DEPLOY_DATA="${DEPLOY_DATA:-false}"
REMOTE_DIR="/srv/silverlining/pos-bar"
APP_USER="silverlining"

if [[ -z "$SERVER" ]]; then
  echo "Missing SERVER. Example: SERVER=deploy@example.com ./deploy.sh"
  exit 1
fi

if [[ ! -d frontend/dist ]]; then
  echo "Missing frontend/dist. Run: cd frontend && npm ci && npm run build"
  exit 1
fi

SSH=(ssh -p "$SSH_PORT" "$SERVER")
SCP=(scp -P "$SSH_PORT")

echo "[1/7] Prepare Silver Lining runtime user and directories"
"${SSH[@]}" "getent group '$APP_USER' >/dev/null || sudo groupadd --system '$APP_USER'; id -u '$APP_USER' >/dev/null 2>&1 || sudo useradd --system --gid '$APP_USER' --home-dir /srv/silverlining --create-home --shell /usr/sbin/nologin '$APP_USER'; sudo install -d -o '$APP_USER' -g '$APP_USER' -m 0750 '$REMOTE_DIR/backend/data' '$REMOTE_DIR/backend/instance' '$REMOTE_DIR/backend/routes' '$REMOTE_DIR/backend/auth' '$REMOTE_DIR/frontend/dist'"

echo "[2/7] Upload backend code and locked dependencies"
"${SSH[@]}" "rm -rf /tmp/silverlining-pos-backend && mkdir -p /tmp/silverlining-pos-backend/routes /tmp/silverlining-pos-backend/auth"
"${SCP[@]}" backend/app.py backend/requirements.txt backend/requirements.lock "$SERVER:/tmp/silverlining-pos-backend/"
"${SCP[@]}" backend/routes/*.py "$SERVER:/tmp/silverlining-pos-backend/routes/"
"${SCP[@]}" backend/auth/*.py "$SERVER:/tmp/silverlining-pos-backend/auth/"
"${SSH[@]}" "sudo install -o '$APP_USER' -g '$APP_USER' -m 0640 /tmp/silverlining-pos-backend/app.py /tmp/silverlining-pos-backend/requirements.txt /tmp/silverlining-pos-backend/requirements.lock '$REMOTE_DIR/backend/'; sudo install -o '$APP_USER' -g '$APP_USER' -m 0640 /tmp/silverlining-pos-backend/routes/*.py '$REMOTE_DIR/backend/routes/'; sudo install -o '$APP_USER' -g '$APP_USER' -m 0640 /tmp/silverlining-pos-backend/auth/*.py '$REMOTE_DIR/backend/auth/'; rm -rf /tmp/silverlining-pos-backend"

if [[ "$DEPLOY_DATA" == "true" ]] || ! "${SSH[@]}" "test -f '$REMOTE_DIR/backend/data/menu.json'"; then
  echo "[3/7] Seed runtime data"
  "${SSH[@]}" "rm -rf /tmp/silverlining-pos-data && mkdir -p /tmp/silverlining-pos-data"
  "${SCP[@]}" backend/data/*.json "$SERVER:/tmp/silverlining-pos-data/"
  "${SSH[@]}" "sudo install -o '$APP_USER' -g '$APP_USER' -m 0640 /tmp/silverlining-pos-data/*.json '$REMOTE_DIR/backend/data/'; rm -rf /tmp/silverlining-pos-data"
else
  echo "[3/7] Preserve existing runtime data"
fi

echo "[4/7] Upload frontend production build"
"${SSH[@]}" "sudo rm -rf '$REMOTE_DIR/frontend/dist' && sudo install -d -o '$APP_USER' -g '$APP_USER' -m 0750 '$REMOTE_DIR/frontend/dist'"
"${SSH[@]}" "rm -rf /tmp/silverlining-pos-dist && mkdir -p /tmp/silverlining-pos-dist"
"${SCP[@]}" -r frontend/dist/. "$SERVER:/tmp/silverlining-pos-dist/"
"${SSH[@]}" "sudo cp -a /tmp/silverlining-pos-dist/. '$REMOTE_DIR/frontend/dist/' && sudo chown -R '$APP_USER:$APP_USER' '$REMOTE_DIR/frontend/dist' && sudo find '$REMOTE_DIR/frontend/dist' -type d -exec chmod 0750 {} + && sudo find '$REMOTE_DIR/frontend/dist' -type f -exec chmod 0640 {} + && rm -rf /tmp/silverlining-pos-dist"

echo "[5/7] Install backend environment"
"${SSH[@]}" "sudo test -x '$REMOTE_DIR/.venv/bin/python' || sudo python3 -m venv '$REMOTE_DIR/.venv'; sudo '$REMOTE_DIR/.venv/bin/python' -m pip install -r '$REMOTE_DIR/backend/requirements.lock'; sudo chown -R '$APP_USER:$APP_USER' '$REMOTE_DIR/.venv'"

echo "[6/7] Install systemd and Nginx configuration"
"${SCP[@]}" deploy/systemd/silverlining-pos.service deploy/nginx/silverlining-pos.conf "$SERVER:/tmp/"
"${SSH[@]}" "sudo usermod -a -G '$APP_USER' www-data; sudo install -m 0644 /tmp/silverlining-pos.service /etc/systemd/system/silverlining-pos.service; sudo install -m 0644 /tmp/silverlining-pos.conf /etc/nginx/sites-available/silverlining-pos; sudo rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/pos-bar; sudo ln -sfn /etc/nginx/sites-available/silverlining-pos /etc/nginx/sites-enabled/silverlining-pos; rm -f /tmp/silverlining-pos.service /tmp/silverlining-pos.conf; sudo nginx -t; sudo systemctl daemon-reload; sudo systemctl enable --now silverlining-pos.service nginx.service; sudo systemctl restart silverlining-pos.service nginx.service"

echo "[7/7] Verify deployment"
"${SSH[@]}" "curl --fail --silent --show-error http://127.0.0.1/api/health"
echo
echo "Deployment completed: $SERVER"
