#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${RUNTIME_DIR:-${HOME}/.seven-lark-runtime}"
UNIT_NAME="feishu-claw.service"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_PATH="${UNIT_DIR}/${UNIT_NAME}"
LOG_FILE="${RUNTIME_DIR}/logs/bridge.log"
BUN_BIN="$(command -v bun 2>/dev/null || echo "$HOME/.bun/bin/bun")"

write_unit() {
  mkdir -p "${UNIT_DIR}" "${RUNTIME_DIR}/logs" "${RUNTIME_DIR}/state"
  cat > "${UNIT_PATH}" <<UNIT
[Unit]
Description=Seven Lark Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${ROOT}
Environment=HOME=${HOME}
Environment=RUNTIME_DIR=${RUNTIME_DIR}
Environment=PATH=${HOME}/.bun/bin:${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin
UnsetEnvironment=http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
ExecStart=${BUN_BIN} run ${ROOT}/src/server.ts
Restart=on-failure
RestartSec=5
StandardOutput=append:${LOG_FILE}
StandardError=append:${LOG_FILE}

[Install]
WantedBy=default.target
UNIT
}

case "${1:-}" in
  install)
    write_unit
    systemctl --user daemon-reload
    systemctl --user enable --now "${UNIT_NAME}"
    echo "Installed ${UNIT_NAME}"
    ;;
  uninstall)
    systemctl --user disable --now "${UNIT_NAME}" 2>/dev/null || true
    rm -f "${UNIT_PATH}"
    systemctl --user daemon-reload
    ;;
  start|stop|restart)
    systemctl --user "$1" "${UNIT_NAME}"
    ;;
  restart-defer)
    delay="${2:-20}"
    [[ "${delay}" =~ ^[0-9]+$ && "${delay}" -ge 3 ]] || { echo "Delay must be at least 3 seconds" >&2; exit 1; }
    systemd-run --user --on-active="${delay}s" /bin/systemctl --user restart "${UNIT_NAME}" >/dev/null
    echo "Restart scheduled in ${delay} seconds"
    ;;
  status)
    systemctl --user status "${UNIT_NAME}" --no-pager
    ;;
  logs)
    tail -f "${LOG_FILE}"
    ;;
  *)
    echo "Usage: $0 <install|uninstall|start|stop|restart|restart-defer|status|logs>" >&2
    exit 1
    ;;
esac
