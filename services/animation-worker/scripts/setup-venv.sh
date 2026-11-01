#!/usr/bin/env bash
# Rebuilds the worker's Python environment (.venv) that rotoscope runs use for DWPose and the
# fidelity gate (server/rotoscope/guardrails.ts checks it before every run).
#
#   pnpm rotoscope:setup
#
# The worker needs Python 3.11 or 3.12 (onnxruntime 1.21 has no wheels for newer ones). With uv
# the right Python is fetched for this venv; without it a python3.12 / python3.11 on PATH is used.
# A venv whose interpreter was removed (its symlink points at nothing) is replaced.
set -euo pipefail

cd "$(dirname "$0")/.."
VENV=.venv

if [ -L "$VENV/bin/python" ] && [ ! -e "$VENV/bin/python" ]; then
  echo "· $VENV/bin/python points at $(readlink "$VENV/bin/python"), which no longer exists: rebuilding $VENV"
  rm -rf "$VENV"
fi

if command -v uv >/dev/null 2>&1; then
  uv venv --python 3.12 --allow-existing "$VENV"
  uv pip install --python "$VENV/bin/python" -e ".[pose,dev]"
else
  PY=""
  for candidate in python3.12 python3.11; do
    if command -v "$candidate" >/dev/null 2>&1; then PY="$candidate"; break; fi
  done
  if [ -z "$PY" ]; then
    echo "✗ Neither uv nor Python 3.11/3.12 was found. Install one of them, then run this again:" >&2
    echo "    brew install uv          (recommended: uv fetches Python 3.12 for this venv)" >&2
    echo "    brew install python@3.12" >&2
    exit 1
  fi
  [ -x "$VENV/bin/python" ] || "$PY" -m venv "$VENV"
  "$VENV/bin/python" -m pip install --upgrade pip
  "$VENV/bin/python" -m pip install -e ".[pose,dev]"
fi

echo "· checking the tools"
"$VENV/bin/python" -I -c "import cv2, numpy, rtmlib, onnxruntime; print('  OpenCV', cv2.__version__, '· NumPy', numpy.__version__, '· onnxruntime', onnxruntime.__version__)"
"$VENV/bin/python" -m pytest -q tests/test_fidelity.py
echo "✓ $(pwd)/$VENV ready: rotoscope runs can draw again"
