import inspect
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import call, patch


PLUGIN_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = PLUGIN_DIR.parents[2]
sys.path.insert(0, str(PLUGIN_DIR))

import control


PENDING_STATUS = json.dumps(
    {"decisionPending": True, "decision": {"decisionId": "abc123"}}
)


def _init_fixture_git_repo(root):
    """Create a minimal committed git repo at *root* for the one real
    end-to-end test below. hermes-dev-control.ps1 requires `git log -1` to
    succeed, so this fixture setup is load-bearing, not incidental — it is
    kept in a single helper so it is the one place test fixtures shell out
    to git rather than four separate call sites.
    """
    for args in (
        ["git", "init", "-q", root],
        ["git", "-C", root, "config", "user.email", "fixture@example.invalid"],
        ["git", "-C", root, "config", "user.name", "Fixture"],
        ["git", "-C", root, "add", "."],
        ["git", "-C", root, "commit", "-qm", "fixture"],
    ):
        subprocess.run(args, check=True)


class ControlTests(unittest.TestCase):
    @patch("control.run_control")
    def test_ros_answer_empty_string(self, run_control):
        self.assertEqual(
            control.handle_ros_answer(""),
            "empty answer: /ros-answer requires literal answer text",
        )
        run_control.assert_not_called()

    @patch("control.run_control")
    def test_ros_answer_whitespace_only(self, run_control):
        self.assertEqual(
            control.handle_ros_answer("   \n  "),
            "empty answer: /ros-answer requires literal answer text",
        )
        run_control.assert_not_called()

    @patch("control.run_control")
    def test_ros_answer_none(self, run_control):
        self.assertEqual(
            control.handle_ros_answer(None),
            "empty answer: /ros-answer requires literal answer text",
        )
        run_control.assert_not_called()

    @patch("control.run_control", return_value=(0, '{"decisionPending": false}', ""))
    def test_ros_answer_no_pending(self, run_control):
        self.assertEqual(control.handle_ros_answer("answer"), "no pending decision")
        run_control.assert_called_once_with(
            ["-Command", "status", "-Json"], control.DEFAULT_REPO_DIR, timeout=30
        )

    @patch("control.run_control", return_value=(1, "", "git status failed"))
    def test_ros_answer_status_failure(self, run_control):
        self.assertEqual(
            control.handle_ros_answer("answer"),
            "ros-answer failed: could not read status: git status failed",
        )
        self.assertEqual(run_control.call_count, 1)

    @patch("control.run_control")
    def test_ros_answer_success_writes_temp_file_and_cleans_up(self, run_control):
        captured = {}

        def invoke(args, repo_dir, **kwargs):
            if args[1] == "status":
                return 0, PENDING_STATUS, ""
            captured["args"] = args
            return 0, "Orchestrator started with PID 4321.", ""

        run_control.side_effect = invoke
        result = control.handle_ros_answer("chosen")
        args = captured["args"]
        self.assertEqual(run_control.call_count, 2)
        self.assertEqual(args[0:2], ["-Command", "answer"])
        self.assertLess(args.index("-AnswerFile"), args.index("-DecisionId"))
        self.assertEqual(args[args.index("-DecisionId") + 1], "abc123")
        temp_path = args[args.index("-AnswerFile") + 1]
        self.assertFalse(os.path.exists(temp_path))
        self.assertEqual(result, "Orchestrator started with PID 4321.")

    @patch("control.run_control")
    def test_ros_answer_multiline_japanese_verbatim(self, run_control):
        raw_args = '回答\n複数行の日本語テスト、絵文字 😀 "引用" と `バッククォート`'
        captured = {}

        def invoke(args, repo_dir, **kwargs):
            if args[1] == "status":
                return 0, PENDING_STATUS, ""
            path = args[args.index("-AnswerFile") + 1]
            with open(path, "r", encoding="utf-8", newline="") as answer_file:
                captured["content"] = answer_file.read()
            return 0, "Orchestrator started with PID 1.", ""

        run_control.side_effect = invoke
        control.handle_ros_answer(raw_args)
        self.assertEqual(captured["content"], raw_args)

    @patch("control.run_control")
    def test_ros_answer_underlying_answer_failure(self, run_control):
        captured = {}

        def invoke(args, repo_dir, **kwargs):
            if args[1] == "status":
                return 0, PENDING_STATUS, ""
            captured["path"] = args[args.index("-AnswerFile") + 1]
            return 1, "", "stale/mismatched decision id"

        run_control.side_effect = invoke
        result = control.handle_ros_answer("answer")
        self.assertIn("stale/mismatched decision id", result)
        self.assertFalse(os.path.exists(captured["path"]))

    @patch(
        "control.run_control",
        return_value=(
            0,
            json.dumps({"decisionPending": True, "decision": {}}),
            "",
        ),
    )
    def test_ros_answer_missing_decision_id(self, run_control):
        self.assertEqual(
            control.handle_ros_answer("answer"),
            "ros-answer failed: pending decision is missing a decisionId",
        )
        self.assertEqual(run_control.call_count, 1)

    @patch("control.run_control")
    def test_ros_answer_calls_control_exactly_once_per_step(self, run_control):
        run_control.side_effect = [
            (0, PENDING_STATUS, ""),
            (0, "Orchestrator started with PID 1.", ""),
        ]
        control.handle_ros_answer("answer")
        self.assertEqual(run_control.call_count, 2)

    @patch("control.run_control", return_value=(0, "started", ""))
    def test_ros_start_success(self, run_control):
        self.assertIn("start requested", control.handle_ros_start("ignored"))
        run_control.assert_called_once_with(
            ["-Command", "start"], control.DEFAULT_REPO_DIR, timeout=30
        )

    @patch("control.run_control", return_value=(1, "", "start error"))
    def test_ros_start_failure(self, run_control):
        self.assertEqual(control.handle_ros_start(""), "ros-start failed: start error")

    @patch("control.run_control", return_value=(0, ' {"running":false}\n', ""))
    def test_ros_status_success(self, run_control):
        self.assertEqual(control.handle_ros_status(""), '{"running":false}')
        run_control.assert_called_once_with(
            ["-Command", "status", "-Json"], control.DEFAULT_REPO_DIR, timeout=30
        )

    @patch("control.run_control", return_value=(1, "status error", ""))
    def test_ros_status_failure(self, run_control):
        self.assertEqual(
            control.handle_ros_status(""), "ros-status failed: status error"
        )

    @patch("control.run_control", return_value=(0, "stopped", ""))
    def test_ros_stop_success(self, run_control):
        self.assertIn("stop requested", control.handle_ros_stop("ignored"))
        run_control.assert_called_once_with(
            ["-Command", "stop"], control.DEFAULT_REPO_DIR, timeout=30
        )

    @patch("control.run_control", return_value=(1, "", "stop error"))
    def test_ros_stop_failure(self, run_control):
        self.assertEqual(control.handle_ros_stop(""), "ros-stop failed: stop error")

    def test_dispatch_rejects_unlisted_operation(self):
        with self.assertRaises(ValueError):
            control.dispatch("rm -rf")

    @patch("control.run_control", return_value=(0, "ok", ""))
    def test_dispatch_only_reaches_run_control_via_allowlisted_args(self, run_control):
        control.dispatch("start")
        run_control.assert_called_once_with(
            ["-Command", "start"], control.DEFAULT_REPO_DIR, timeout=30
        )

    def test_run_control_uses_argv_list_not_shell(self):
        source = Path(inspect.getsourcefile(control)).read_text(encoding="utf-8")
        self.assertNotIn("shell=True", source)

    @patch("control.subprocess.run")
    def test_run_control_timeout_does_not_raise(self, run):
        run.side_effect = subprocess.TimeoutExpired(cmd="x", timeout=30)
        result = control.run_control(["-Command", "status"])
        self.assertEqual(result[0:2], (1, ""))
        self.assertIn("timed out", result[2])

    def test_run_control_real_invocation_against_fixture_repo(self):
        if shutil.which(control.POWERSHELL_EXE) is None:
            self.skipTest("powershell.exe is not on PATH")
        with tempfile.TemporaryDirectory(prefix="ros-control-fixture-") as root:
            root_path = Path(root)
            scripts = root_path / "scripts"
            control_dir = root_path / ".ai" / "control"
            scripts.mkdir(parents=True)
            control_dir.mkdir(parents=True)
            shutil.copy(
                REPO_ROOT / "scripts" / "hermes-dev-control.ps1",
                scripts / "hermes-dev-control.ps1",
            )
            shutil.copy(
                REPO_ROOT / "scripts" / "hermes-lock-identity.ps1",
                scripts / "hermes-lock-identity.ps1",
            )
            (scripts / "hermes-orchestrate.ps1").write_text(
                "param([string]$RepoDir)\n", encoding="utf-8"
            )
            _init_fixture_git_repo(root)

            returncode, stdout, stderr = control.run_control(
                ["-Command", "status", "-Json"], repo_dir=root
            )
            self.assertEqual(returncode, 0, stderr)
            status = json.loads(stdout)
            self.assertFalse(status["decisionPending"], stdout)


if __name__ == "__main__":
    unittest.main()
