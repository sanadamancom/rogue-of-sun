# ROGUE OF SOL Hermes control plugin

This native Hermes plugin dispatches `/ros-start`, `/ros-status`, `/ros-stop`, and `/ros-answer` before any LLM call. That makes the bounded repository control flow deterministic instead of depending on skill selection or model judgment.

## Install

From the repository root:

```powershell
hermes plugins doctor tools\hermes-plugins\ros-control --ci
Copy-Item -Recurse -Force tools\hermes-plugins\ros-control "$env:USERPROFILE\.hermes\plugins\ros-control"
hermes plugins enable ros-control
hermes gateway restart
```

The doctor command manages its own interpreter; use it directly even if the plain `hermes` command's interpreter behaves differently from `C:\Users\ai\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe`.

Newly installed or updated plugins are not loaded by an already-running gateway. After installation or update, run `hermes gateway restart` (or `hermes gateway stop` followed by `hermes gateway start`).

## Update

After pulling changes to this directory, re-run the copy command and then restart the gateway:

```powershell
Copy-Item -Recurse -Force tools\hermes-plugins\ros-control "$env:USERPROFILE\.hermes\plugins\ros-control"
hermes gateway restart
```

Once the plugin is confirmed loaded and working, three `quick_commands` entries in the Hermes agent's own configuration become redundant duplicates, since plugin-registered commands already take precedence over them: the ones named `ros-start`, `ros-status`, and `ros-stop`. Cleaning up those duplicates, if desired, is a manual step for the human operator to perform through Hermes's own configuration tooling — this plugin does not read, write, or otherwise touch that configuration itself.

This plugin requires `C:\dev\rogue-of-sun\scripts\hermes-dev-control.ps1` at its fixed absolute path. It is specific to this repository checkout and is not portable.
