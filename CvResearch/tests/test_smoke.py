import json
import subprocess
import sys
from pathlib import Path

EXAMPLE_VIDEO = Path(__file__).parent.parent / "example_video.mp4"

def test_output_schema():
    result = subprocess.run(
        [sys.executable, str(Path(__file__).parent.parent / "main.py"),
         str(EXAMPLE_VIDEO)],
        capture_output=True, text=True, timeout=120,
    )
    assert result.returncode == 0, result.stderr
    data = json.loads(result.stdout)
    assert "meta" in data
    assert "samples" in data
    assert "aggregates" in data
    assert isinstance(data["samples"], list)
    assert data["meta"]["sample_count"] == len(data["samples"])