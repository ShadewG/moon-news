#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/apps/moon-news"
VENV_PATH="${AGENT_REACH_VENV:-$ROOT/.venv-agent-reach}"
PACKAGE_SPEC="${AGENT_REACH_PACKAGE_SPEC:-https://github.com/Panniantong/Agent-Reach/archive/main.zip}"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required to install Agent Reach" >&2
  exit 1
fi

uv venv "$VENV_PATH"
uv pip install --python "$VENV_PATH/bin/python" --upgrade "$PACKAGE_SPEC"

echo "Agent Reach installed at $VENV_PATH"
echo "Recommended env:"
echo "  AGENT_REACH_PYTHON=$VENV_PATH/bin/python"
