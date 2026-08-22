"""Bounded control handlers for the ROGUE OF SOL Hermes plugin."""

import json
import os
from pathlib import Path
import subprocess
import tempfile


DEFAULT_REPO_DIR = r"C:\dev\rogue-of-sun"
CONTROL_SCRIPT_RELATIVE = r"scripts\hermes-dev-control.ps1"
POWERSHELL_EXE = "powershell.exe"

# Fixed argv fragments per operation. This is the only place operation
# names are allowed to originate; handlers below select a key from this
# mapping, never a caller-supplied string, so run_control() never receives
# an unbounded -Command value.
_OPERATION_ARGS = {
    "start": ("start",),
    "status": ("status", "-Json"),
    "stop": ("stop",),
    "answer": ("answer",),
}


def run_control(args, repo_dir=DEFAULT_REPO_DIR, timeout=30):
    control_script = Path(repo_dir) / CONTROL_SCRIPT_RELATIVE
    argv = [
        POWERSHELL_EXE,
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(control_script),
        *args,
        "-RepoDir",
        str(repo_dir),
    ]
    try:
        completed = subprocess.run(argv, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return 1, "", f"control command timed out after {timeout}s"
    stdout = completed.stdout.decode("utf-8", errors="replace")
    stderr = completed.stderr.decode("utf-8", errors="replace")
    return completed.returncode, stdout, stderr


def dispatch(operation, extra_args=(), repo_dir=DEFAULT_REPO_DIR, timeout=30):
    """Run one allowlisted ros-control operation through run_control().

    ``operation`` must be a key of ``_OPERATION_ARGS``; this is the single
    chokepoint through which every handler below reaches the subprocess
    wrapper, so the set of possible -Command values is fixed at import time
    and never grows from caller input.
    """
    if operation not in _OPERATION_ARGS:
        raise ValueError(f"unsupported ros-control operation: {operation!r}")
    args = ["-Command", *_OPERATION_ARGS[operation], *extra_args]
    return run_control(args, repo_dir, timeout=timeout)


def _failure_detail(stdout, stderr):
    return (stderr or stdout).strip()


def handle_ros_start(raw_args, repo_dir=DEFAULT_REPO_DIR):
    returncode, stdout, stderr = dispatch("start", repo_dir=repo_dir)
    if returncode == 0:
        return "ROGUE OF SOL Hermes orchestrator start requested."
    return f"ros-start failed: {_failure_detail(stdout, stderr)}"


def handle_ros_status(raw_args, repo_dir=DEFAULT_REPO_DIR):
    returncode, stdout, stderr = dispatch("status", repo_dir=repo_dir)
    if returncode == 0:
        return stdout.strip()
    return f"ros-status failed: {_failure_detail(stdout, stderr)}"


def handle_ros_stop(raw_args, repo_dir=DEFAULT_REPO_DIR):
    returncode, stdout, stderr = dispatch("stop", repo_dir=repo_dir)
    if returncode == 0:
        return "ROGUE OF SOL Hermes orchestrator stop requested."
    return f"ros-stop failed: {_failure_detail(stdout, stderr)}"


def handle_ros_answer(raw_args, repo_dir=DEFAULT_REPO_DIR):
    if raw_args is None or raw_args.strip() == "":
        return "empty answer: /ros-answer requires literal answer text"

    returncode, stdout, stderr = dispatch("status", repo_dir=repo_dir)
    if returncode != 0:
        return (
            "ros-answer failed: could not read status: "
            f"{_failure_detail(stdout, stderr)}"
        )
    try:
        status = json.loads(stdout)
    except (json.JSONDecodeError, TypeError):
        return "ros-answer failed: could not parse status output"

    if not status.get("decisionPending"):
        return "no pending decision"
    decision = status.get("decision") or {}
    decision_id = decision.get("decisionId")
    if not decision_id:
        return "ros-answer failed: pending decision is missing a decisionId"

    descriptor, path = tempfile.mkstemp(prefix="ros-answer-", suffix=".txt")
    os.close(descriptor)
    try:
        with open(path, "w", encoding="utf-8", newline="") as answer_file:
            answer_file.write(raw_args)
        returncode, stdout, stderr = dispatch(
            "answer",
            extra_args=["-AnswerFile", path, "-DecisionId", decision_id],
            repo_dir=repo_dir,
            timeout=30,
        )
        if returncode != 0:
            return f"ros-answer failed: {_failure_detail(stdout, stderr)}"
        return stdout.strip()
    finally:
        try:
            if os.path.exists(path):
                os.remove(path)
        except OSError:
            pass
