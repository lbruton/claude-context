#!/usr/bin/env python3
"""Post-edit lint hook for claude-context (DEVS-90) — type-checks .ts edits.

On a .ts edit, runs `tsc --noEmit -p <package>` for the workspace package
that contains the file (nearest tsconfig.json below the repo root), the same
check as that package's `typecheck` script.

Not run:
- root `tsc --noEmit`: the root tsconfig references removed packages
  (vscode-extension, chrome-extension) and fails before checking anything
- ESLint: there is no ESLint 9 flat config in the repo, so eslint errors out
  on every file

Claude Code drops plain stdout from PostToolUse hooks, so findings are
emitted as hookSpecificOutput.additionalContext JSON. Clean edits and files
outside a package print nothing. Always exits 0 (non-blocking).

Also accepts Codex apply_patch payloads (patch text in tool_input.command)
so the same script can back a .codex/hooks.json if one is added.
"""

import json
import os
import re
import subprocess
import sys

# .claude/hooks/post-edit-lint.py -> repo root, so worktrees lint their own tree
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__))))
TSC = os.path.join(PROJECT_DIR, "node_modules", ".bin", "tsc")
TSC_TIMEOUT = 30
MAX_LINES = 10

PATCH_PATH_RE = re.compile(r"^\*\*\* (?:Add File|Update File|Move to): (.+)$")


def edited_files(tool_name, tool_input, cwd):
    """Absolute paths of the files the tool call wrote."""
    if tool_name in ("Edit", "Write", "MultiEdit"):
        path = tool_input.get("file_path", "")
        return [path] if path else []
    if tool_name == "apply_patch":
        lines = str(tool_input.get("command", "")).splitlines()
        paths = []
        for i, line in enumerate(lines):
            m = PATCH_PATH_RE.match(line)
            if not m:
                continue
            # An Update followed by Move to only exists at the destination
            if line.startswith("*** Update File:") and i + 1 < len(lines) and lines[i + 1].startswith("*** Move to:"):
                continue
            paths.append(os.path.join(cwd, m.group(1).strip()))
        return paths
    return []


def package_dir(file_path):
    """Nearest directory with a tsconfig.json between the file and the repo root (exclusive)."""
    d = os.path.dirname(os.path.realpath(file_path))
    while d.startswith(PROJECT_DIR + os.sep):
        if os.path.isfile(os.path.join(d, "tsconfig.json")):
            return d
        d = os.path.dirname(d)
    return None


def typecheck(pkg):
    """Run tsc --noEmit for one package. Returns a finding string or None."""
    rel = os.path.relpath(pkg, PROJECT_DIR)
    try:
        result = subprocess.run(
            [TSC, "--noEmit", "-p", rel],
            cwd=PROJECT_DIR,
            capture_output=True,
            text=True,
            timeout=TSC_TIMEOUT,
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    if result.returncode == 0:
        return None
    lines = (result.stdout + result.stderr).strip().splitlines()
    body = "\n".join(lines[:MAX_LINES])
    if len(lines) > MAX_LINES:
        body += f"\n... ({len(lines) - MAX_LINES} more lines)"
    return f"tsc ({rel}):\n{body}" if body else None


def main():
    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return
    if not isinstance(data, dict) or not os.access(TSC, os.X_OK):
        return

    tool_input = data.get("tool_input") or {}
    cwd = data.get("cwd") or os.getcwd()
    packages = []
    for path in edited_files(data.get("tool_name", ""), tool_input, cwd):
        if path.endswith(".ts") and os.path.isfile(path):
            pkg = package_dir(path)
            if pkg and pkg not in packages:
                packages.append(pkg)

    findings = [f for f in (typecheck(p) for p in packages) if f]
    if findings:
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": "[lint] " + "\n[lint] ".join(findings),
            }
        }))


if __name__ == "__main__":
    main()
    sys.exit(0)
