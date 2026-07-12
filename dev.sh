#!/bin/bash

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
RUN_DIR="$ROOT_DIR/.run"
BACKEND_PID="$RUN_DIR/backend.pid"
FRONTEND_PID="$RUN_DIR/frontend.pid"
BACKEND_LOG="$RUN_DIR/backend.log"
FRONTEND_LOG="$RUN_DIR/frontend.log"
BACKEND_PORT=27779
FRONTEND_PORT=27778

mkdir -p "$RUN_DIR"

is_running() {
  local pid_file="$1"
  [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file" 2>/dev/null)" 2>/dev/null
}

pid_for_port() {
  local port="$1"
  # -sTCP:LISTEN filters out client connections — we only want the listener.
  lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1
}

# Print a PID followed by all its descendants (children first, root last).
# macOS pgrep lacks -r / --parent-tree, so we recurse manually via ps.
collect_tree() {
  local root="$1"
  [ -z "$root" ] && return
  local child
  for child in $(ps -Ao pid=,ppid= 2>/dev/null | awk -v p="$root" '$2 == p { print $1 }'); do
    collect_tree "$child"
  done
  printf '%s\n' "$root"
}

stop_one() {
  local name="$1"
  local port="$2"

  # Source of truth: whatever holds the port. Also fall back to the recorded
  # PID file in case the process is mid-shutdown and briefly off the port.
  local -a roots=()
  local port_pid
  port_pid="$(pid_for_port "$port")"
  [ -n "$port_pid" ] && roots+=("$port_pid")

  echo "Stopping $name ..."

  # Gather the union of all PIDs across every root tree, deduped.
  local -a to_kill=()
  local seen=":"
  local root pid
  for root in "${roots[@]}"; do
    while read -r pid; do
      [ -z "$pid" ] && continue
      case "$seen" in
        *":$pid:"*) continue ;;
      esac
      seen="$seen$pid:"
      to_kill+=("$pid")
    done < <(collect_tree "$root")
  done

  if [ "${#to_kill[@]}" -eq 0 ]; then
    echo "$name is not running."
    return
  fi

  # SIGTERM the whole forest.
  for pid in "${to_kill[@]}"; do
    kill "$pid" 2>/dev/null || true
  done

  # Wait up to 5s for the port to clear.
  local i
  for i in 1 2 3 4 5; do
    [ -z "$(pid_for_port "$port")" ] && break
    sleep 1
  done

  # SIGKILL any survivors.
  for pid in "${to_kill[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      echo "  force killing $pid"
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
}

refuse_if_port_busy() {
  local label="$1"
  local port="$2"
  if [ -n "$(pid_for_port "$port")" ]; then
    echo "Cannot start $label: port $port is already in use."
    echo "  Run ./dev.sh stop first, or identify the holder:"
    echo "    lsof -i tcp:$port"
    exit 1
  fi
}

start() {
  if [ ! -x "$ROOT_DIR/.venv/bin/python" ]; then
    echo "Missing Python virtualenv. Run: python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt"
    exit 1
  fi

  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    echo "Missing frontend dependencies. Run: cd frontend && npm ci"
    exit 1
  fi

  refuse_if_port_busy "backend" "$BACKEND_PORT"
  refuse_if_port_busy "frontend" "$FRONTEND_PORT"

  echo "Starting backend on http://localhost:$BACKEND_PORT ..."
  # exec replaces the bash wrapper with python itself, so $! stored below is
  # the actual server PID (killable directly, no orphaned children).
  nohup bash -c 'cd "$1" && exec "$2" app.py' _ "$BACKEND_DIR" "$ROOT_DIR/.venv/bin/python" >"$BACKEND_LOG" 2>&1 &
  echo $! > "$BACKEND_PID"

  echo "Starting frontend on http://localhost:$FRONTEND_PORT ..."
  # Call vite directly (skip the npm wrapper) and pin the port so it can't
  # silently drift to 27780+ when something else grabbed 27778.
  nohup bash -c 'cd "$1" && exec "$2" --host 0.0.0.0 --port "$3" --strictPort' _ "$FRONTEND_DIR" "$FRONTEND_DIR/node_modules/.bin/vite" "$FRONTEND_PORT" >"$FRONTEND_LOG" 2>&1 &
  echo $! > "$FRONTEND_PID"

  echo "Started."
  echo "Frontend: http://localhost:$FRONTEND_PORT"
  echo "Backend:  http://localhost:$BACKEND_PORT/api/health"
  echo "Logs:     tail -f .run/backend.log .run/frontend.log"
}

stop() {
  stop_one "frontend" "$FRONTEND_PORT"
  rm -f "$FRONTEND_PID"
  stop_one "backend" "$BACKEND_PORT"
  rm -f "$BACKEND_PID"
}

status() {
  local be_port_pid fe_port_pid
  be_port_pid="$(pid_for_port "$BACKEND_PORT")"
  fe_port_pid="$(pid_for_port "$FRONTEND_PORT")"

  if [ -n "$be_port_pid" ]; then
    echo "backend running on :$BACKEND_PORT (pid $be_port_pid)"
  else
    echo "backend stopped"
  fi

  if [ -n "$fe_port_pid" ]; then
    echo "frontend running on :$FRONTEND_PORT (pid $fe_port_pid)"
  else
    echo "frontend stopped"
  fi
}

case "${1:-start}" in
  start)
    start
    ;;
  stop)
    stop
    ;;
  restart)
    stop
    start
    ;;
  status)
    status
    ;;
  logs)
    tail -f "$BACKEND_LOG" "$FRONTEND_LOG"
    ;;
  *)
    echo "Usage: ./dev.sh {start|stop|restart|status|logs}"
    exit 1
    ;;
esac
