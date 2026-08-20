#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${ROOT}/config/bridge.env"
EXAMPLE="${ROOT}/config/bridge.env.linux.example"
RUNTIME_DIR="${RUNTIME_DIR:-${HOME}/.seven-lark-runtime}"

if [[ ! -f "${CONFIG}" ]]; then
  cp "${EXAMPLE}" "${CONFIG}"
  echo "Created ${CONFIG}; fill FEISHU_APP_ID and FEISHU_APP_SECRET, then run again."
  exit 0
fi

# shellcheck disable=SC1090
source "${CONFIG}"
: "${FEISHU_APP_ID:?Set FEISHU_APP_ID in config/bridge.env}"
: "${FEISHU_APP_SECRET:?Set FEISHU_APP_SECRET in config/bridge.env}"
command -v bun >/dev/null || { echo "Bun was not found" >&2; exit 1; }
command -v codex >/dev/null || { echo "Codex CLI was not found" >&2; exit 1; }

(cd "${ROOT}" && bun install --frozen-lockfile)
mkdir -p "${RUNTIME_DIR}/logs" "${RUNTIME_DIR}/state"
echo "Linux installation complete."
echo "Start: bash ${ROOT}/scripts/claw-service-linux.sh start"
