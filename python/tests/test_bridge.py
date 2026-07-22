"""Subprocess tests for the AlphaStudio Python bridge (stdlib ``unittest``).

Run with the interpreter under test:

    python -m unittest python/tests/test_bridge.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
BRIDGE = os.path.join(os.path.dirname(HERE), "bridge.py")


def _run(args: list, cwd: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, BRIDGE, *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=60,
    )


class BridgeJsonTransformTest(unittest.TestCase):
    def test_json_array_to_csv(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "data.json")
            out_dir = os.path.join(tmp, "out")
            os.makedirs(out_dir, exist_ok=True)
            with open(src, "w", encoding="utf-8") as handle:
                json.dump([{"a": 1, "b": "x"}, {"a": 2, "b": "y"}], handle)

            proc = _run(
                [
                    "--operation", "data.json-transform",
                    "--input", src,
                    "--output-dir", out_dir,
                    "--options", json.dumps({"format": "csv"}),
                    "--limits", json.dumps({"maxOutputBytes": 1_000_000}),
                ],
                cwd=tmp,
            )

            self.assertEqual(proc.returncode, 0, msg=proc.stderr)
            payload = json.loads(proc.stdout)
            self.assertEqual(payload["protocol"], 1)
            self.assertEqual(len(payload["outputs"]), 1)
            out_path = os.path.join(out_dir, payload["outputs"][0]["name"])
            self.assertTrue(os.path.isfile(out_path))
            with open(out_path, "r", encoding="utf-8") as handle:
                text = handle.read()
            self.assertEqual(text, "a,b\n1,x\n2,y\n")
            self.assertEqual(payload["meta"]["rows"], 2)

    def test_tsv_delimiter(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "data.json")
            out_dir = os.path.join(tmp, "out")
            os.makedirs(out_dir, exist_ok=True)
            with open(src, "w", encoding="utf-8") as handle:
                json.dump([{"a": 1, "b": 2}], handle)

            proc = _run(
                [
                    "--operation", "data.json-transform",
                    "--input", src,
                    "--output-dir", out_dir,
                    "--options", json.dumps({"format": "tsv"}),
                ],
                cwd=tmp,
            )

            self.assertEqual(proc.returncode, 0, msg=proc.stderr)
            payload = json.loads(proc.stdout)
            out_path = os.path.join(out_dir, payload["outputs"][0]["name"])
            with open(out_path, "r", encoding="utf-8") as handle:
                self.assertEqual(handle.read(), "a\tb\n1\t2\n")

    def test_invalid_json_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "bad.json")
            out_dir = os.path.join(tmp, "out")
            os.makedirs(out_dir, exist_ok=True)
            with open(src, "w", encoding="utf-8") as handle:
                handle.write("{not valid json")

            proc = _run(
                [
                    "--operation", "data.json-transform",
                    "--input", src,
                    "--output-dir", out_dir,
                    "--options", json.dumps({"format": "csv"}),
                ],
                cwd=tmp,
            )
            self.assertEqual(proc.returncode, 1)
            self.assertIn("JSON", proc.stderr)

    def test_unknown_operation_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = os.path.join(tmp, "out")
            os.makedirs(out_dir, exist_ok=True)
            proc = _run(
                [
                    "--operation", "does.not-exist",
                    "--output-dir", out_dir,
                ],
                cwd=tmp,
            )
            self.assertEqual(proc.returncode, 1)
            self.assertIn("Unknown operation", proc.stderr)


if __name__ == "__main__":
    unittest.main()
