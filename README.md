# Seven Lark Bridge

Seven Lark Bridge 以飞书群聊话题作为远程入口，由部署电脑上已登录的 Codex App Server 执行开发任务。机器人持续更新任务卡，支持并行话题、实时引导、停止任务、聊天记忆、定时任务、图片和文件输入。

## 工作方式

- 仅在群聊话题中执行任务，私聊不会调用 Codex。
- 每个飞书话题对应独立 Codex Session，不同话题可以并行。
- 未授权用户首次 @机器人时，管理员会收到批准或拒绝卡片。
- 所有任务按钮均校验点击者的飞书 `OPEN_ID`。
- Windows 默认允许 Codex 操作 `D:\Seven`，权限不会超过运行服务的 Windows 用户。
- 不包含 Web 工作台，全部控制和结果都在飞书中完成。

## 依赖说明

项目依赖已经通过 `package.json` 和 `bun.lock` 固定版本。一键部署会自动安装或检查：

| 依赖 | 一键部署处理 | 说明 |
|---|---|---|
| Bun | Windows 自动安装；Linux 缺失时询问安装 | 运行 TypeScript、SQLite 和飞书 SDK |
| 项目依赖 | 自动执行 `bun install --frozen-lockfile` | 不需要手动复制 `node_modules` |
| Codex CLI | 检查安装和登录状态；Linux 可询问 npm 安装 | 必须使用部署电脑自己的 Codex 认证 |
| Git | 不自动安装 | 仅克隆或更新项目时需要，也可以下载源码压缩包 |
| PowerShell | Windows 自带 | 用于安装和管理计划任务 |
| systemd | Linux 后台模式需要 | 手动前台模式不需要 systemd 或 linger |

不应把 `node_modules`、Codex 登录凭据或平台可执行文件提交到 Git。Codex 认证属于每台电脑的本地状态，不能随项目复制。

## 飞书应用准备

建议一台电脑对应一个独立飞书应用/机器人。飞书开发者后台需要：

1. 创建企业自建应用并开启机器人能力。
2. 在事件与回调中选择长连接模式。
3. 订阅事件 `im.message.receive_v1`。
4. 添加回调 `card.action.trigger`。
5. 授予读取群聊 @消息、发送消息、读取话题消息和下载消息资源所需权限。
6. 创建并发布应用版本。
7. 将机器人加入需要使用的群聊。

配置文件最终包含：

```dotenv
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxx
FEISHU_OWNER_OPEN_ID=ou_xxxxxxxxxxxxxxxx
```

`APP_ID` 标识应用，`OWNER_OPEN_ID` 标识该应用视角下的管理员用户，二者不能互相推导。同一个人在不同飞书应用下的 `OPEN_ID` 可能不同。

获取管理员 `OPEN_ID`：

1. 发布机器人并在群聊话题中 @机器人发送一条消息。
2. 在飞书开发者后台找到对应的 `im.message.receive_v1` 事件日志。
3. 复制 `sender.sender_id.open_id`。
4. 将其填写为 `FEISHU_OWNER_OPEN_ID`，然后重新运行部署脚本。

## Windows 一键部署

推荐项目位置为 `D:\Seven\seven-lark-bridge`：

```powershell
New-Item -ItemType Directory -Force D:\Seven
Set-Location D:\Seven
git clone https://github.com/seven-chenxianghui/lark-bridge.git seven-lark-bridge
Set-Location D:\Seven\seven-lark-bridge
powershell -ExecutionPolicy Bypass -File scripts\deploy-windows.ps1
```

部署脚本会：

1. 询问缺失的飞书 App ID、App Secret 和管理员 OPEN_ID。
2. 检查 Codex 是否安装并已登录。
3. 缺少 Bun 时自动安装。
4. 按锁文件安装项目依赖。
5. 实际请求飞书 App Access Token，验证 App 凭据。
6. 输出当前电脑是否满足运行条件。
7. 让用户自行选择运行方式。

Windows 运行方式：

- `1 手动运行`：立即在后台启动，但不创建开机任务；电脑重启后需手动启动。
- `2 开机后台运行`：创建 `AtStartup` 计划任务，需要确认 UAC 并输入 Windows 账户的实际密码，不能使用 PIN。
- `3 暂不启动`：只完成配置和依赖安装。

也可以跳过交互式选择：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy-windows.ps1 -RunMode Manual
powershell -ExecutionPolicy Bypass -File scripts\deploy-windows.ps1 -RunMode Startup
powershell -ExecutionPolicy Bypass -File scripts\deploy-windows.ps1 -RunMode Skip
```

Windows 服务管理：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\claw-service-windows.ps1 status
powershell -ExecutionPolicy Bypass -File scripts\claw-service-windows.ps1 logs
powershell -ExecutionPolicy Bypass -File scripts\claw-service-windows.ps1 start
powershell -ExecutionPolicy Bypass -File scripts\claw-service-windows.ps1 restart
powershell -ExecutionPolicy Bypass -File scripts\claw-service-windows.ps1 stop
powershell -ExecutionPolicy Bypass -File scripts\claw-service-windows.ps1 uninstall
```

## Linux 一键部署

```bash
git clone https://github.com/seven-chenxianghui/lark-bridge.git ~/seven-lark-bridge
cd ~/seven-lark-bridge
bash scripts/deploy-linux.sh
```

Linux 提供三种选择：

- `1 手动前台运行`：当前终端运行，按 `Ctrl+C` 停止，不安装服务。
- `2 systemd 用户服务`：安装并启用用户服务；若 linger 未启用，会先询问并通过 `sudo loginctl enable-linger "$USER"` 启用。
- `3 暂不启动`：只完成配置、依赖和就绪检查。

也可以显式选择：

```bash
bash scripts/deploy-linux.sh --run-mode manual
bash scripts/deploy-linux.sh --run-mode systemd
bash scripts/deploy-linux.sh --run-mode skip
```

Linux 服务管理：

```bash
bash scripts/claw-service-linux.sh status
bash scripts/claw-service-linux.sh logs
bash scripts/claw-service-linux.sh restart
bash scripts/claw-service-linux.sh stop
bash scripts/claw-service-linux.sh uninstall
```

## 就绪检查

完成依赖安装后，Windows 和 Linux 都可以运行：

```bash
bun run ready
```

检查结果包括飞书配置及真实凭据验证、管理员身份、项目依赖和 Codex 登录状态。只有全部必需项显示 `[OK]` 并输出 `READY` 时，当前电脑才满足使用条件。

## 飞书使用

- 在群聊中创建话题并 @机器人发送文字、图片或文件。
- 单条消息最多处理 4 个文件，每个文件最大 20 MB；临时附件处理后删除。
- 未授权用户会触发管理员审批，不会执行 Codex。
- `/help` 查看命令，`/status` 查看状态，`/new` 清除会话，`/stop` 停止任务。
- `/plan <任务>` 先只读分析，批准后再修改。
- `/记忆 <关键词>` 查询 SQLite 记忆。
- `/定时 30m <任务>` 创建周期任务。

## 本地数据

| 内容 | Windows 默认路径 | Linux 默认路径 |
|---|---|---|
| 飞书配置 | `config\bridge.env` | `config/bridge.env` |
| 运行数据 | `D:\Seven\.seven-lark-runtime` | `~/.seven-lark-runtime` |
| 权限数据库 | `state\access-control.sqlite` | `state/access-control.sqlite` |
| 聊天记忆 | `state\chat-memory.sqlite` | `state/chat-memory.sqlite` |
| 日志 | `logs\bridge.log` | `logs/bridge.log` |

聊天记忆使用 SQLite FTS5 和本地轻量 Embedding，不需要额外的云端 Embedding API Key。本地配置、运行数据和 Codex 凭据不会提交到 Git。

## 多电脑部署

- 推荐每台电脑使用独立飞书应用和机器人。
- 不要让两台电脑同时使用同一个 App ID 建立长连接，否则消息可能被不同实例接收。
- 授权数据库、聊天记忆和 Codex Session 都是本机状态，不会通过 Git 自动同步。
- 如果只是更换电脑，应先停止旧电脑服务，再启动新电脑。

## 开发验证

```bash
npm test
npm run verify
```

Windows 真实 Codex App Server 验证：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\verify-codex-agent.ps1
```

Linux 脚本语法检查：

```bash
bash -n scripts/*.sh
```

## 常见问题

**就绪检查提示 Codex 未登录**：运行 `codex login` 后再执行 `bun run ready`。安装 Codex 桌面端不代表 CLI 一定已经完成认证。

**Windows 开机任务安装失败**：确认 UAC 已批准，并输入 Windows 账户实际密码而不是 PIN。状态应显示 `trigger=AtStartup`、`logon=Password` 和 `Running PID`。

**Linux 锁屏或注销后停止**：选择 systemd 模式并检查 `loginctl show-user "$USER" -p Linger`。手动前台模式在终端退出后停止是预期行为。

**电脑休眠后无法响应**：锁屏不影响运行，但睡眠、休眠和关机会暂停所有本机进程；唤醒且网络恢复后飞书长连接会重新连接。
