#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${ROOT}/config/bridge.env"
EXAMPLE="${ROOT}/config/bridge.env.linux.example"
RUN_MODE="ask"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-mode) RUN_MODE="${2:-}"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
[[ "${RUN_MODE}" =~ ^(ask|manual|systemd|skip)$ ]] || { echo "Invalid run mode" >&2; exit 2; }

env_value() {
  local key="$1"
  awk -F= -v key="${key}" '$1 == key { sub(/^[^=]*=/, ""); gsub(/^['"'"']|['"'"']$/, ""); print; exit }' "${CONFIG}" 2>/dev/null || true
}

set_env_value() {
  local key="$1" value="$2" temp found=0
  temp="$(mktemp)"
  while IFS= read -r line || [[ -n "${line}" ]]; do
    if [[ "${line}" == "${key}="* ]]; then
      printf '%s=%s\n' "${key}" "${value}" >> "${temp}"
      found=1
    else
      printf '%s\n' "${line}" >> "${temp}"
    fi
  done < "${CONFIG}"
  [[ ${found} -eq 1 ]] || printf '%s=%s\n' "${key}" "${value}" >> "${temp}"
  mv "${temp}" "${CONFIG}"
}

ask_yes_no() {
  local prompt="$1" reply
  read -r -p "${prompt} [Y/n] " reply
  [[ -z "${reply}" || "${reply}" =~ ^[Yy]$ ]]
}

echo "=== Seven Lark Bridge 一键部署（Linux） ==="
[[ -f "${CONFIG}" ]] || cp "${EXAMPLE}" "${CONFIG}"

app_id="$(env_value FEISHU_APP_ID)"
if [[ -z "${app_id}" || "${app_id}" == *xxxxxxxx* ]]; then
  read -r -p "请输入飞书 FEISHU_APP_ID（cli_ 开头）: " app_id
  set_env_value FEISHU_APP_ID "${app_id}"
fi
app_secret="$(env_value FEISHU_APP_SECRET)"
if [[ -z "${app_secret}" ]]; then
  read -r -s -p "请输入飞书 FEISHU_APP_SECRET: " app_secret
  echo
  set_env_value FEISHU_APP_SECRET "${app_secret}"
fi
owner_open_id="$(env_value FEISHU_OWNER_OPEN_ID)"
if [[ -z "${owner_open_id}" ]]; then
  echo "新飞书应用需要管理员 OPEN_ID，可从 im.message.receive_v1 事件的 sender.sender_id.open_id 获取。"
  read -r -p "请输入 FEISHU_OWNER_OPEN_ID；已有迁移数据时可直接回车: " owner_open_id
  [[ -z "${owner_open_id}" ]] || set_env_value FEISHU_OWNER_OPEN_ID "${owner_open_id}"
fi

if ! command -v bun >/dev/null 2>&1; then
  ask_yes_no "未找到 Bun，是否现在安装" || { echo "请先安装 Bun" >&2; exit 1; }
  command -v curl >/dev/null || { echo "安装 Bun 需要 curl" >&2; exit 1; }
  curl -fsSL https://bun.sh/install | bash
  export PATH="${HOME}/.bun/bin:${PATH}"
fi
if ! command -v codex >/dev/null 2>&1; then
  if command -v npm >/dev/null 2>&1 && ask_yes_no "未找到 Codex CLI，是否使用 npm 安装"; then
    npm install -g @openai/codex
  else
    echo "请先安装并登录 Codex CLI" >&2
    exit 1
  fi
fi

bash "${ROOT}/scripts/install-linux.sh"
echo
echo "=== 当前就绪状态 ==="
if ! bun run "${ROOT}/scripts/check-readiness.ts"; then
  echo "当前尚不满足启动条件。处理上面的 MISSING 项后重新运行本脚本。" >&2
  exit 1
fi

if [[ "${RUN_MODE}" == "ask" ]]; then
  echo
  echo "选择运行方式："
  echo "  1. 手动前台运行（关闭终端即停止）"
  echo "  2. systemd 用户服务（开机后台运行，可启用 linger）"
  echo "  3. 暂不启动"
  read -r -p "请输入 1、2 或 3: " choice
  case "${choice}" in
    1) RUN_MODE="manual" ;;
    2) RUN_MODE="systemd" ;;
    *) RUN_MODE="skip" ;;
  esac
fi

echo
echo "飞书后台仍需确认：机器人能力已开启、长连接已启用、已订阅 im.message.receive_v1 和 card.action.trigger、应用版本已发布。"
case "${RUN_MODE}" in
  systemd)
    if command -v loginctl >/dev/null 2>&1 && [[ "$(loginctl show-user "${USER}" -p Linger --value 2>/dev/null || true)" != "yes" ]]; then
      echo "正在启用 linger；系统可能要求输入 sudo 密码。"
      sudo loginctl enable-linger "${USER}"
    fi
    bash "${ROOT}/scripts/claw-service-linux.sh" install
    bash "${ROOT}/scripts/claw-service-linux.sh" status
    ;;
  manual)
    echo "开始前台运行；按 Ctrl+C 停止。"
    cd "${ROOT}"
    exec bun run src/server.ts
    ;;
  skip)
    echo "已完成部署，未启动服务。手动运行：cd '${ROOT}' && bun run src/server.ts"
    ;;
esac
