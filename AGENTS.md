# Repository Instructions

This repository packages a Feishu-to-Codex bridge for Linux and Windows.

## Change Rules

- Keep Linux and Windows profiles Codex-only.
- Use the locally authenticated Codex CLI for every agent execution path.
- Maintain bridge behavior in `src/`; treat `config/bridge.env` and the external `.seven-lark-runtime` directory as local state.
- Preserve authorization gates, topic isolation, and sandbox selection in code rather than prompts.
- Do not restart the bridge while it is serving the current task; use the deferred restart command when needed.

## Verification

```bash
npm test
npm run verify
bash -n scripts/*.sh
```

On Windows also parse the PowerShell scripts and run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/verify-codex-agent.ps1
```

## Deployment

Linux:

```bash
bash scripts/install-linux.sh
bash scripts/claw-service-linux.sh restart
bash scripts/claw-service-linux.sh status
```

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-windows.ps1
powershell -ExecutionPolicy Bypass -File scripts/claw-service-windows.ps1 restart
powershell -ExecutionPolicy Bypass -File scripts/claw-service-windows.ps1 status
```
