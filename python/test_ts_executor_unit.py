#!/usr/bin/env python3
"""
Unit tests for TypeScriptExecutor (ts_executor.py).

These tests mock subprocess.Popen so that no real TypeScript compilation
or Node.js execution occurs.  They verify the logic in TypeScriptExecutor
and the call_ts_method convenience function.
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, call, patch

# Make sure the python directory is importable
sys.path.insert(0, str(Path(__file__).parent))

from ts_executor import TypeScriptExecutor, call_ts_method


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_popen_mock(
    stdout_lines: list[str], returncode: int = 0, stderr: str = ""
) -> MagicMock:
    """Return a configured mock for subprocess.Popen."""
    mock_proc = MagicMock()
    mock_proc.poll.return_value = returncode

    # readline() streams each line then returns "" to signal EOF
    stdout_sequence = [line + "\n" for line in stdout_lines] + [""]
    mock_proc.stdout.readline.side_effect = stdout_sequence
    mock_proc.stderr.read.return_value = stderr

    return mock_proc


# ---------------------------------------------------------------------------
# Tests for TypeScriptExecutor.__init__
# ---------------------------------------------------------------------------

class TestTypeScriptExecutorInit(unittest.TestCase):
    def test_default_working_dir_is_cwd(self):
        executor = TypeScriptExecutor()
        self.assertEqual(executor.working_dir, os.getcwd())

    def test_custom_working_dir_stored(self):
        executor = TypeScriptExecutor(working_dir="/tmp/custom")
        self.assertEqual(executor.working_dir, "/tmp/custom")

    def test_none_working_dir_defaults_to_cwd(self):
        executor = TypeScriptExecutor(working_dir=None)
        self.assertEqual(executor.working_dir, os.getcwd())


# ---------------------------------------------------------------------------
# Tests for TypeScriptExecutor._create_wrapper_script
# ---------------------------------------------------------------------------

class TestCreateWrapperScript(unittest.TestCase):
    def setUp(self):
        self.executor = TypeScriptExecutor()

    def test_imports_target_module_without_ts_extension(self):
        script = self.executor._create_wrapper_script(
            "/some/dir/myModule.ts", "myMethod", [], {}
        )
        # import path should strip .ts
        self.assertIn("from './myModule'", script)
        self.assertNotIn("from './myModule.ts'", script)

    def test_imports_file_without_extension_unchanged(self):
        script = self.executor._create_wrapper_script(
            "/some/dir/myModule", "myMethod", [], {}
        )
        self.assertIn("from './myModule'", script)

    def test_method_name_appears_in_wrapper(self):
        script = self.executor._create_wrapper_script(
            "/some/dir/file.ts", "doSomething", [], {}
        )
        self.assertIn("doSomething", script)

    def test_positional_args_serialised_as_json(self):
        args = [1, "hello", True]
        script = self.executor._create_wrapper_script(
            "/some/dir/file.ts", "fn", args, {}
        )
        self.assertIn(json.dumps(args), script)

    def test_keyword_args_serialised_as_json(self):
        kwargs = {"key": "value", "num": 42}
        script = self.executor._create_wrapper_script(
            "/some/dir/file.ts", "fn", [], kwargs
        )
        self.assertIn(json.dumps(kwargs), script)

    def test_empty_args_and_kwargs_produces_valid_script(self):
        script = self.executor._create_wrapper_script(
            "/some/dir/file.ts", "fn", [], {}
        )
        self.assertIn("executeMethod", script)
        self.assertIn("JSON.stringify(result)", script)

    def test_script_contains_async_function(self):
        script = self.executor._create_wrapper_script(
            "/some/dir/file.ts", "fn", [], {}
        )
        self.assertIn("async function executeMethod", script)

    def test_kwargs_passed_as_last_positional_argument(self):
        script = self.executor._create_wrapper_script(
            "/some/dir/file.ts", "fn", [], {"a": 1}
        )
        # When kwargs is non-empty, the wrapper should spread args and append kwargs
        self.assertIn("method(...args, kwargs)", script)

    def test_only_positional_args_when_no_kwargs(self):
        script = self.executor._create_wrapper_script(
            "/some/dir/file.ts", "fn", [1, 2], {}
        )
        # Both branches are always emitted in the template; verify the guard condition
        # and the positional-only branch are present
        self.assertIn("method(...args)", script)
        self.assertIn("Object.keys(kwargs).length > 0", script)


# ---------------------------------------------------------------------------
# Tests for TypeScriptExecutor.call_method
# ---------------------------------------------------------------------------

class TestCallMethod(unittest.TestCase):
    def setUp(self):
        # Create a real temporary TS file so FileNotFoundError is not raised
        self.tmp_dir = tempfile.mkdtemp()
        self.ts_file = os.path.join(self.tmp_dir, "target.ts")
        with open(self.ts_file, "w") as f:
            f.write("export function add(a: number, b: number) { return a + b; }\n")
        self.executor = TypeScriptExecutor(working_dir=self.tmp_dir)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    # -- FileNotFoundError when TS file is missing --

    def test_raises_file_not_found_for_missing_ts_file(self):
        executor = TypeScriptExecutor(working_dir=self.tmp_dir)
        with self.assertRaises(FileNotFoundError):
            executor.call_method("nonexistent.ts", "fn")

    def test_resolves_relative_path_against_working_dir(self):
        """A relative ts_file_path should be joined with working_dir."""
        with patch("subprocess.Popen") as mock_popen:
            mock_proc = make_popen_mock(['42'])
            mock_popen.return_value = mock_proc

            result = self.executor.call_method("target.ts", "add", 20, 22)
            self.assertEqual(result, 42)

    # -- Happy-path JSON result parsing --

    def test_returns_parsed_json_from_last_json_line(self):
        with patch("subprocess.Popen") as mock_popen:
            mock_proc = make_popen_mock([
                "Some console.log output",
                '{"result": "ok"}',
            ])
            mock_popen.return_value = mock_proc

            result = self.executor.call_method(self.ts_file, "fn")
            self.assertEqual(result, {"result": "ok"})

    def test_returns_last_json_line_when_multiple_json_lines(self):
        with patch("subprocess.Popen") as mock_popen:
            mock_proc = make_popen_mock([
                '{"intermediate": true}',
                "log message",
                '{"final": "value"}',
            ])
            mock_popen.return_value = mock_proc

            result = self.executor.call_method(self.ts_file, "fn")
            self.assertEqual(result, {"final": "value"})

    def test_returns_numeric_json_result(self):
        with patch("subprocess.Popen") as mock_popen:
            mock_proc = make_popen_mock(["42"])
            mock_popen.return_value = mock_proc

            result = self.executor.call_method(self.ts_file, "fn")
            self.assertEqual(result, 42)

    def test_returns_boolean_json_result(self):
        with patch("subprocess.Popen") as mock_popen:
            mock_proc = make_popen_mock(["true"])
            mock_popen.return_value = mock_proc

            result = self.executor.call_method(self.ts_file, "fn")
            self.assertTrue(result)

    def test_returns_list_json_result(self):
        with patch("subprocess.Popen") as mock_popen:
            mock_proc = make_popen_mock(['[1, 2, 3]'])
            mock_popen.return_value = mock_proc

            result = self.executor.call_method(self.ts_file, "fn")
            self.assertEqual(result, [1, 2, 3])

    # -- Non-JSON fallback --

    def test_returns_last_nonempty_line_when_no_json_found(self):
        with patch("subprocess.Popen") as mock_popen:
            mock_proc = make_popen_mock([
                "plain text line one",
                "plain text line two",
            ])
            mock_popen.return_value = mock_proc

            result = self.executor.call_method(self.ts_file, "fn")
            self.assertEqual(result, "plain text line two")

    def test_returns_none_when_no_output(self):
        with patch("subprocess.Popen") as mock_popen:
            mock_proc = make_popen_mock([])
            mock_popen.return_value = mock_proc

            result = self.executor.call_method(self.ts_file, "fn")
            self.assertIsNone(result)

    # -- Non-zero return code raises RuntimeError --

    def test_raises_runtime_error_on_nonzero_exit(self):
        with patch("subprocess.Popen") as mock_popen:
            mock_proc = make_popen_mock(
                [],
                returncode=1,
                stderr="SyntaxError: Unexpected token",
            )
            mock_popen.return_value = mock_proc

            with self.assertRaises(RuntimeError) as ctx:
                self.executor.call_method(self.ts_file, "fn")
            self.assertIn("TypeScript execution failed", str(ctx.exception))

    def test_error_message_from_stderr_in_exception(self):
        with patch("subprocess.Popen") as mock_popen:
            mock_proc = make_popen_mock([], returncode=1, stderr="Custom error message")
            mock_popen.return_value = mock_proc

            with self.assertRaises(RuntimeError) as ctx:
                self.executor.call_method(self.ts_file, "fn")
            self.assertIn("Custom error message", str(ctx.exception))

    # -- Temporary file cleanup --

    def test_temp_file_cleaned_up_on_success(self):
        created_files = []

        original_mkstemp = tempfile.mkstemp

        def tracking_mkstemp(*args, **kwargs):
            fd, path = original_mkstemp(*args, **kwargs)
            created_files.append(path)
            return fd, path

        with patch("subprocess.Popen") as mock_popen:
            mock_proc = make_popen_mock(['null'])
            mock_popen.return_value = mock_proc

            with patch("tempfile.mkstemp", side_effect=tracking_mkstemp):
                self.executor.call_method(self.ts_file, "fn")

        for p in created_files:
            self.assertFalse(os.path.exists(p), f"Temp file not cleaned up: {p}")

    def test_temp_file_cleaned_up_on_failure(self):
        created_files = []

        original_mkstemp = tempfile.mkstemp

        def tracking_mkstemp(*args, **kwargs):
            fd, path = original_mkstemp(*args, **kwargs)
            created_files.append(path)
            return fd, path

        with patch("subprocess.Popen") as mock_popen:
            mock_proc = make_popen_mock([], returncode=1, stderr="fail")
            mock_popen.return_value = mock_proc

            with patch("tempfile.mkstemp", side_effect=tracking_mkstemp):
                with self.assertRaises(RuntimeError):
                    self.executor.call_method(self.ts_file, "fn")

        for p in created_files:
            self.assertFalse(os.path.exists(p), f"Temp file not cleaned up: {p}")

    # -- Popen invocation details --

    def test_npx_ts_node_invoked_with_temp_file(self):
        with patch("subprocess.Popen") as mock_popen:
            mock_proc = make_popen_mock(['null'])
            mock_popen.return_value = mock_proc

            self.executor.call_method(self.ts_file, "fn")

            args, kwargs = mock_popen.call_args
            cmd = args[0]
            self.assertEqual(cmd[0], "npx")
            self.assertEqual(cmd[1], "ts-node")
            # Third element is the temp file path (ends with .ts)
            self.assertTrue(cmd[2].endswith(".ts"))

    def test_popen_cwd_is_working_dir(self):
        with patch("subprocess.Popen") as mock_popen:
            mock_proc = make_popen_mock(['null'])
            mock_popen.return_value = mock_proc

            self.executor.call_method(self.ts_file, "fn")

            _, kwargs = mock_popen.call_args
            self.assertEqual(kwargs["cwd"], self.tmp_dir)

    def test_non_json_console_log_is_printed(self):
        """Lines that are not JSON should be printed to stdout."""
        with patch("subprocess.Popen") as mock_popen:
            mock_proc = make_popen_mock(["Hello from TS", '{"x": 1}'])
            mock_popen.return_value = mock_proc

            with patch("builtins.print") as mock_print:
                self.executor.call_method(self.ts_file, "fn")
                printed_args = [str(c[0][0]) for c in mock_print.call_args_list]
                self.assertIn("Hello from TS", printed_args)

    def test_json_lines_not_printed_to_stdout(self):
        """Lines that parse as JSON should NOT be printed (they are the result)."""
        with patch("subprocess.Popen") as mock_popen:
            mock_proc = make_popen_mock(['{"key": "val"}'])
            mock_popen.return_value = mock_proc

            with patch("builtins.print") as mock_print:
                self.executor.call_method(self.ts_file, "fn")
                printed_args = [str(c[0][0]) for c in mock_print.call_args_list]
                self.assertNotIn('{"key": "val"}', printed_args)


# ---------------------------------------------------------------------------
# Tests for the call_ts_method convenience function
# ---------------------------------------------------------------------------

class TestCallTsMethodConvenienceFunction(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.ts_file = os.path.join(self.tmp_dir, "lib.ts")
        with open(self.ts_file, "w") as f:
            f.write("export function greet(name: string) { return `Hello, ${name}`; }\n")

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_call_ts_method_returns_result(self):
        with patch("subprocess.Popen") as mock_popen:
            mock_proc = make_popen_mock(['"Hello, World"'])
            mock_popen.return_value = mock_proc

            result = call_ts_method(self.ts_file, "greet", "World")
            self.assertEqual(result, "Hello, World")

    def test_call_ts_method_passes_working_dir(self):
        with patch("subprocess.Popen") as mock_popen:
            mock_proc = make_popen_mock(['"ok"'])
            mock_popen.return_value = mock_proc

            call_ts_method(self.ts_file, "fn", working_dir=self.tmp_dir)

            _, kwargs = mock_popen.call_args
            self.assertEqual(kwargs["cwd"], self.tmp_dir)

    def test_call_ts_method_uses_cwd_when_no_working_dir(self):
        with patch("subprocess.Popen") as mock_popen:
            mock_proc = make_popen_mock(['"ok"'])
            mock_popen.return_value = mock_proc

            call_ts_method(self.ts_file, "fn")

            _, kwargs = mock_popen.call_args
            self.assertEqual(kwargs["cwd"], os.getcwd())

    def test_call_ts_method_raises_for_missing_file(self):
        with self.assertRaises(FileNotFoundError):
            call_ts_method(
                os.path.join(self.tmp_dir, "missing.ts"),
                "fn",
                working_dir=self.tmp_dir,
            )


# ---------------------------------------------------------------------------
# Additional edge-case / regression tests
# ---------------------------------------------------------------------------

class TestEdgeCases(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.ts_file = os.path.join(self.tmp_dir, "edge.ts")
        with open(self.ts_file, "w") as f:
            f.write("export function fn() {}\n")
        self.executor = TypeScriptExecutor(working_dir=self.tmp_dir)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_absolute_ts_file_path_used_directly(self):
        """When ts_file_path is absolute it should not be joined with working_dir."""
        with patch("subprocess.Popen") as mock_popen:
            mock_proc = make_popen_mock(['"result"'])
            mock_popen.return_value = mock_proc

            self.executor.call_method(self.ts_file, "fn")

            args, _ = mock_popen.call_args
            # The temp file is in the same directory as the absolute target file
            temp_file = args[0][2]
            self.assertEqual(os.path.dirname(temp_file), self.tmp_dir)

    def test_null_json_result_returned_as_none(self):
        with patch("subprocess.Popen") as mock_popen:
            mock_proc = make_popen_mock(["null"])
            mock_popen.return_value = mock_proc

            result = self.executor.call_method(self.ts_file, "fn")
            self.assertIsNone(result)

    def test_unknown_error_without_stderr_raises_runtime_error(self):
        with patch("subprocess.Popen") as mock_popen:
            mock_proc = make_popen_mock([], returncode=1, stderr="")
            mock_popen.return_value = mock_proc

            with self.assertRaises(RuntimeError) as ctx:
                self.executor.call_method(self.ts_file, "fn")
            self.assertIn("Unknown error", str(ctx.exception))

    def test_deeply_nested_json_object_returned(self):
        nested = {"a": {"b": {"c": [1, 2, 3]}}}
        with patch("subprocess.Popen") as mock_popen:
            mock_proc = make_popen_mock([json.dumps(nested)])
            mock_popen.return_value = mock_proc

            result = self.executor.call_method(self.ts_file, "fn")
            self.assertEqual(result, nested)

    def test_wrapper_script_escapes_backtick_import_path_safely(self):
        """Import path must use single-quoted string to avoid injection."""
        executor = TypeScriptExecutor(working_dir=self.tmp_dir)
        script = executor._create_wrapper_script(
            os.path.join(self.tmp_dir, "myLib.ts"),
            "myFunc",
            [],
            {},
        )
        # The import statement must use single quotes around the path
        self.assertRegex(script, r"from\s+'\.\/myLib'")


if __name__ == "__main__":
    unittest.main()