from pathlib import Path
import sys

_PLUGIN_DIR = Path(__file__).parent
if str(_PLUGIN_DIR) not in sys.path:
    sys.path.insert(0, str(_PLUGIN_DIR))

import control


def register(ctx):
    ctx.register_command(
        "ros-start",
        handler=control.handle_ros_start,
        description="Start the ROGUE OF SOL Hermes orchestrator (bounded, deterministic, no LLM routing).",
    )
    ctx.register_command(
        "ros-status",
        handler=control.handle_ros_status,
        description="Show ROGUE OF SOL Hermes orchestrator status as raw JSON (bounded, deterministic, no LLM routing).",
    )
    ctx.register_command(
        "ros-stop",
        handler=control.handle_ros_stop,
        description="Request a cooperative stop of the ROGUE OF SOL Hermes orchestrator (bounded, deterministic, no LLM routing).",
    )
    ctx.register_command(
        "ros-answer",
        handler=control.handle_ros_answer,
        description="Answer a pending ROGUE OF SOL human decision verbatim (bounded, deterministic, no LLM routing).",
    )
