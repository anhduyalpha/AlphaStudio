"""Subprocess tests for the AlphaStudio Python bridge (stdlib ``unittest``).

Run with the interpreter under test:

    python -m unittest python/tests/test_bridge.py
"""

from __future__ import annotations

import importlib.util
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


class BridgeTableTransformTest(unittest.TestCase):
    def test_csv_to_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "data.csv")
            out_dir = os.path.join(tmp, "out")
            os.makedirs(out_dir, exist_ok=True)
            with open(src, "w", encoding="utf-8", newline="") as handle:
                handle.write("a,b\n1,x\n2,y\n")

            proc = _run(
                [
                    "--operation", "data.table-transform",
                    "--input", src,
                    "--output-dir", out_dir,
                    "--options", json.dumps({"format": "json"}),
                ],
                cwd=tmp,
            )
            self.assertEqual(proc.returncode, 0, msg=proc.stderr)
            payload = json.loads(proc.stdout)
            out_path = os.path.join(out_dir, payload["outputs"][0]["name"])
            with open(out_path, "r", encoding="utf-8") as handle:
                self.assertEqual(json.load(handle), [{"a": "1", "b": "x"}, {"a": "2", "b": "y"}])
            self.assertEqual(payload["meta"]["rows"], 2)

    def test_tsv_to_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "data.tsv")
            out_dir = os.path.join(tmp, "out")
            os.makedirs(out_dir, exist_ok=True)
            with open(src, "w", encoding="utf-8", newline="") as handle:
                handle.write("a\tb\n1\t2\n")

            proc = _run(
                [
                    "--operation", "data.table-transform",
                    "--input", src,
                    "--output-dir", out_dir,
                    "--options", json.dumps({"format": "json"}),
                ],
                cwd=tmp,
            )
            self.assertEqual(proc.returncode, 0, msg=proc.stderr)
            payload = json.loads(proc.stdout)
            out_path = os.path.join(out_dir, payload["outputs"][0]["name"])
            with open(out_path, "r", encoding="utf-8") as handle:
                self.assertEqual(json.load(handle), [{"a": "1", "b": "2"}])

    def test_parquet_target_gated_on_data_profile(self) -> None:
        """json -> parquet needs pandas+pyarrow; assert success or a clean error."""
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "data.json")
            out_dir = os.path.join(tmp, "out")
            os.makedirs(out_dir, exist_ok=True)
            with open(src, "w", encoding="utf-8") as handle:
                json.dump([{"a": 1, "b": 2}], handle)

            proc = _run(
                [
                    "--operation", "data.table-transform",
                    "--input", src,
                    "--output-dir", out_dir,
                    "--options", json.dumps({"format": "parquet"}),
                ],
                cwd=tmp,
            )
            have_stack = (
                importlib.util.find_spec("pandas") is not None
                and importlib.util.find_spec("pyarrow") is not None
            )
            if have_stack:
                self.assertEqual(proc.returncode, 0, msg=proc.stderr)
            else:
                self.assertEqual(proc.returncode, 1)
                self.assertIn("data profile", proc.stderr)


class BridgeSelfcheckTest(unittest.TestCase):
    def test_selfcheck_reports_modules_and_operations(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            proc = _run(["--selfcheck"], cwd=tmp)
            self.assertEqual(proc.returncode, 0, msg=proc.stderr)
            payload = json.loads(proc.stdout)
            self.assertEqual(payload["protocol"], 1)
            self.assertIn("modules", payload)
            self.assertIn("pandas", payload["modules"])
            self.assertIn("data.table-transform", payload["operations"])
            self.assertIn("document.to-pdf", payload["operations"])


class BridgeSpecializedOpsTest(unittest.TestCase):
    """Phase 3 ops must fail with an actionable message when their profile is absent."""

    def _write(self, tmp: str, name: str) -> str:
        path = os.path.join(tmp, name)
        with open(path, "wb") as handle:
            handle.write(b"%PDF-1.4\n" if name.endswith(".pdf") else b"\x89PNG\r\n")
        return path

    def _assert_gated(self, operation: str, filename: str, module: str, profile: str) -> None:
        if importlib.util.find_spec(module) is not None:
            self.skipTest(f"{module} is installed; skipping absent-profile assertion")
        with tempfile.TemporaryDirectory() as tmp:
            src = self._write(tmp, filename)
            out_dir = os.path.join(tmp, "out")
            os.makedirs(out_dir, exist_ok=True)
            proc = _run(
                [
                    "--operation", operation,
                    "--input", src,
                    "--output-dir", out_dir,
                    "--options", json.dumps({}),
                ],
                cwd=tmp,
            )
            self.assertEqual(proc.returncode, 1)
            self.assertIn(f"{profile} profile", proc.stderr)

    def test_ocr_searchable_gated_on_ocr_profile(self) -> None:
        self._assert_gated("pdf.ocr-searchable", "scan.pdf", "ocrmypdf", "ocr")

    def test_deskew_gated_on_vision_profile(self) -> None:
        self._assert_gated("image.deskew", "scan.png", "cv2", "vision")

    def test_autocrop_gated_on_vision_profile(self) -> None:
        self._assert_gated("image.autocrop", "scan.png", "cv2", "vision")

    def test_extract_tables_gated_on_documents_profile(self) -> None:
        self._assert_gated("pdf.extract-tables", "report.pdf", "camelot", "documents")

    def test_transcribe_gated_on_ai_profile(self) -> None:
        self._assert_gated("media.transcribe", "clip.wav", "faster_whisper", "ai")

    def test_background_removal_gated_on_vision_profile(self) -> None:
        self._assert_gated("image.background-removal", "photo.png", "rembg", "vision")


if __name__ == "__main__":
    unittest.main()
