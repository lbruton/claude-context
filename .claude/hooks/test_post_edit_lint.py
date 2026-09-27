#!/usr/bin/env python3
"""Contract tests for post-edit-lint.py (DEVS-90).

Run: python3 -m unittest discover -s .claude/hooks -p 'test_*.py'

Claude Code drops plain stdout from PostToolUse hooks, so findings must come
back as hookSpecificOutput.additionalContext JSON, and clean edits must print
nothing. Scratch .ts files go under packages/core/src so the package tsconfig
(include: src/**/*) picks them up.
"""

import json
import os
import shutil
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.realpath(__file__))
HOOK = os.path.join(HERE, "post-edit-lint.py")
ROOT = os.path.dirname(os.path.dirname(HERE))
CORE_SRC = os.path.join(ROOT, "packages", "core", "src")
HAS_TSC = os.access(os.path.join(ROOT, "node_modules", ".bin", "tsc"), os.X_OK)


def run_hook(payload, raw=None):
    res = subprocess.run(
        ["python3", HOOK],
        input=raw if raw is not None else json.dumps(payload),
        capture_output=True,
        text=True,
        cwd=ROOT,
        timeout=90,
    )
    assert res.returncode == 0, f"hook exited {res.returncode}: {res.stderr}"
    return res.stdout.strip()


def context_of(stdout):
    assert stdout, "expected JSON output, got nothing"
    out = json.loads(stdout)["hookSpecificOutput"]
    assert out["hookEventName"] == "PostToolUse"
    return out["additionalContext"]


class PostEditLintTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="hooktest-scratch-", dir=CORE_SRC)

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def scratch(self, name, body, where=None):
        path = os.path.join(where or self.dir, name)
        with open(path, "w") as f:
            f.write(body)
        return path

    def edit(self, path, tool="Edit"):
        return run_hook({"tool_name": tool, "tool_input": {"file_path": path}})

    @unittest.skipUnless(HAS_TSC, "run pnpm install first")
    def test_type_error_in_package_is_reported(self):
        ctx = context_of(self.edit(self.scratch("bad.ts", "export const n: number = 'x';\n")))
        self.assertIn("TS2322", ctx)
        self.assertIn("packages/core", ctx)

    @unittest.skipUnless(HAS_TSC, "run pnpm install first")
    def test_clean_ts_is_silent(self):
        self.assertEqual(self.edit(self.scratch("clean.ts", "export const n: number = 1;\n"), "Write"), "")

    def test_ts_outside_any_package_is_skipped(self):
        root_dir = tempfile.mkdtemp(prefix="hooktest-scratch-", dir=ROOT)
        try:
            path = self.scratch("bad.ts", "export const n: number = 'x';\n", where=root_dir)
            self.assertEqual(self.edit(path), "")
        finally:
            shutil.rmtree(root_dir, ignore_errors=True)

    def test_file_outside_repo_is_skipped(self):
        outside = tempfile.mkdtemp(prefix="hooktest-outside-")
        try:
            path = self.scratch("bad.ts", "export const n: number = 'x';\n", where=outside)
            self.assertEqual(self.edit(path), "")
        finally:
            shutil.rmtree(outside, ignore_errors=True)

    def test_non_ts_file_and_unrelated_tool_are_silent(self):
        self.assertEqual(self.edit(self.scratch("notes.md", "#  whatever\n")), "")
        self.assertEqual(run_hook({"tool_name": "Bash", "tool_input": {"command": "ls"}}), "")
        self.assertEqual(run_hook(None, raw="not json"), "")


if __name__ == "__main__":
    unittest.main()
