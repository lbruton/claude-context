#!/usr/bin/env python3
"""Post-edit lint hook for claude-context — runs tsc --noEmit + eslint on .ts file edits."""

import json
import subprocess
import sys
import os

PROJECT_DIR = "/Volumes/DATA/GitHub/claude-context"
TSC_TIMEOUT = 30
TSC_MAX_LINES = 10
ESLINT_TIMEOUT = 15
ESLINT_MAX_LINES = 10


def main():
    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        return

    tool_name = data.get("tool_name", "")
    if tool_name not in ("Edit", "Write"):
        return

    file_path = data.get("tool_input", {}).get("file_path", "")
    if not file_path or not file_path.endswith(".ts"):
        return

    if not os.path.isfile(file_path):
        return

    # Run project-wide type check
    try:
        result = subprocess.run(
            ["npx", "tsc", "--noEmit"],
            cwd=PROJECT_DIR,
            capture_output=True,
            text=True,
            timeout=TSC_TIMEOUT,
        )
        if result.returncode != 0:
            lines = (result.stdout + result.stderr).strip().splitlines()
            for line in lines[:TSC_MAX_LINES]:
                print(f"[lint] {line}")
            if len(lines) > TSC_MAX_LINES:
                print(f"[lint] ... ({len(lines) - TSC_MAX_LINES} more lines)")
    except subprocess.TimeoutExpired:
        print("[lint] tsc timed out after 30s")
    except FileNotFoundError:
        pass

    # Run eslint on the specific file
    try:
        result = subprocess.run(
            ["npx", "eslint", file_path],
            cwd=PROJECT_DIR,
            capture_output=True,
            text=True,
            timeout=ESLINT_TIMEOUT,
        )
        if result.returncode != 0:
            lines = (result.stdout + result.stderr).strip().splitlines()
            for line in lines[:ESLINT_MAX_LINES]:
                print(f"[lint] {line}")
            if len(lines) > ESLINT_MAX_LINES:
                print(f"[lint] ... ({len(lines) - ESLINT_MAX_LINES} more lines)")
    except subprocess.TimeoutExpired:
        print("[lint] eslint timed out after 15s")
    except FileNotFoundError:
        pass


if __name__ == "__main__":
    main()
