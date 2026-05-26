# Task 1: Add expression-capable face pipeline

## ☀️ Overview

Currently the system only detects whether a face is present (`has_face: true/false`). This task upgrades the face pipeline to use MediaPipe's FaceLandmarker, which produces 52 ARKit blendshape coefficients per frame (e.g. `mouthSmile`, `eyeSquint`, `browInnerUp`). Instructors' emotional delivery — smiling, raised brows, squinting — can then be quantified instead of just their presence.

## 🔨 Technical details

**1. Files to modify**
- `CvResearch/main.py` — sole file; all changes go here

**2. New model constant**
Add alongside the existing `FACE_MODEL_PATH`/`POSE_MODEL_PATH` block (lines 18–35):
```python
DEFAULT_FACE_LANDMARKER_PATH = MODEL_DIR / "face_landmarker.task"
FACE_LANDMARKER_PATH = Path(
    os.environ.get("MP_FACE_LANDMARKER_PATH", str(DEFAULT_FACE_LANDMARKER_PATH))
)
FACE_LANDMARKER_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/1/face_landmarker.task"
)
```

**3. Update `create_detectors()`** (lines 52–87)
- Replace `ensure_model(FACE_MODEL_PATH, FACE_MODEL_URL)` with `ensure_model(FACE_LANDMARKER_PATH, FACE_LANDMARKER_URL)`
- Replace the `FaceDetectorOptions` / `FaceDetector.create_from_options` block with:
```python
from mediapipe.tasks.python.vision import FaceLandmarker, FaceLandmarkerOptions
face_options = FaceLandmarkerOptions(
    base_options=python.BaseOptions(
        model_asset_path=str(FACE_LANDMARKER_PATH),
        delegate=python.BaseOptions.Delegate.CPU,
    ),
    running_mode=vision.RunningMode.IMAGE,
    output_face_blendshapes=True,
    min_face_detection_confidence=0.5,
    min_face_presence_confidence=0.5,
)
face = FaceLandmarker.create_from_options(face_options)
```
- Keep the OpenCV CascadeClassifier fallback unchanged; it still sets `has_face` via bounding box presence.

**4. Update the frame-processing loop** (lines 128–155)
- Replace:
```python
face_res = face.detect(mp_image)
has_face = bool(face_res.detections)
```
with:
```python
face_res = face.detect(mp_image)
has_face = bool(face_res.face_landmarks)
blendshapes = (
    {b.category_name: b.score for b in face_res.face_blendshapes[0]}
    if face_res.face_blendshapes else {}
)
```
- Update the `rows.append(...)` dict to include `"blendshapes": blendshapes`.

**5. Resource cleanup**
- The existing `face.close()` call at line 160 works unchanged for `FaceLandmarker`.

**6. Edge cases / notes**
- `FaceLandmarker` returns one result set per detected face; index `[0]` is fine for the single-instructor use case. If multiple faces appear, take `[0]` (closest/largest).
- Blendshapes are only non-empty when `output_face_blendshapes=True` AND a face is detected; always guard with `if face_res.face_blendshapes`.
- The old `FACE_MODEL_PATH` / `FACE_MODEL_URL` constants can be removed once `FaceDetector` is fully replaced. Keep the OpenCV cascade fallback for headless environments.
- Model file is ~3 MB. `ensure_model` will auto-download on first run.
- **Assumption:** Single-speaker Zoom recording (one face). Multi-face handling is out of scope.

## 📚 References
- `CvResearch/main.py:38–49` — `ensure_model` pattern to reuse
- `CvResearch/main.py:52–87` — `create_detectors` to modify
- [MediaPipe FaceLandmarker Python guide](https://ai.google.dev/mediapipe/solutions/vision/face_landmarker/python)
- [ARKit blendshape names list](https://ai.google.dev/mediapipe/solutions/vision/face_landmarker#blendshapes) — 52 coefficients, all `[0.0, 1.0]`
- `MP_FACE_LANDMARKER_PATH` — new env var, consistent with existing `MP_FACE_MODEL_PATH` / `MP_POSE_MODEL_PATH` naming

---

# Task 2: Formal `analyze_zoom_segment` API and JSON schema

## ☀️ Overview

Today `CvResearch/main.py` is a run-once script with a hardcoded video filename and no callable interface. This task turns it into an importable Python module with a single well-defined function, `analyze_zoom_segment(video_path, ...)`, that any caller (CLI, web backend, notebook) can invoke. It returns structured JSON — no side effects, no PNG dumps, no print-driven output. The flat script logic is refactored into small reusable functions.

## 🔨 Technical details

**1. File changes**
- `CvResearch/main.py` — full refactor; all top-level imperative code moves into functions
- No new files needed for this task alone

**2. Target function signature**
```python
def analyze_zoom_segment(
    video_path: str | Path,
    *,
    max_duration_s: float = 300.0,
    sample_hz: float = 1.0,
    start_offset_s: float = 0.0,
) -> dict:
```

**3. Target JSON schema**
```json
{
  "meta": {
    "video_path": "example_video3.mov",
    "backend": "tasks",
    "fps": 29.97,
    "effective_duration_s": 42.0,
    "sample_hz": 1.0,
    "sample_count": 42,
    "total_wall_s": 3.21,
    "setup_error": ""
  },
  "samples": [
    {
      "sec": 0,
      "frame_ms": 48.2,
      "has_face": true,
      "has_pose": true,
      "blendshapes": { "mouthSmile_L": 0.12, "browInnerUp": 0.04 }
    }
  ],
  "aggregates": {}
}
```
`aggregates` is intentionally empty here; it is populated in Task 4.

**4. Refactor plan**

Extract these functions from the current flat logic:

| New function | Extracted from | Responsibility |
|---|---|---|
| `_load_video(path)` | lines 111–112 | Opens `VideoCapture`, returns `(cap, fps)` |
| `_sample_frames(cap, start_s, end_s, sample_hz)` | lines 119–157 | Generator yielding `(sec, frame_bgr)` |
| `_process_frame(frame_bgr, backend, face, pose)` | lines 125–155 | Returns `(has_face, has_pose, blendshapes, frame_ms)` |
| `create_detectors()` | lines 52–87 | Already a function; keep, add `face_landmarker` from Task 1 |
| `ensure_model()` | lines 38–49 | Already a function; unchanged |

**5. `__main__` CLI wrapper** — keep at bottom for direct script use:
```python
if __name__ == "__main__":
    import json, sys
    result = analyze_zoom_segment(sys.argv[1])
    json.dump(result, sys.stdout, indent=2)
```

**6. Annotated image output**
- Remove the `cv2.imwrite` loop (lines 168–171) from the module path.
- Optionally add a `save_annotated: bool = False` kwarg if debug images are still needed.

**7. Edge cases / notes**
- `cap.read()` returns `(False, None)` at EOF; the existing `if not ok: break` handles this.
- `VideoCapture` must be released on error paths — wrap loop in `try/finally`.
- `create_detectors()` mutates global state via `ensure_model`; this is acceptable at module level but should not run at import time. Move the top-level `create_detectors()` call inside `analyze_zoom_segment`.
- **Open question:** Should detectors be cached across calls to `analyze_zoom_segment` (singleton) or recreated each call? Singleton is faster for batch jobs; recreating is simpler and avoids state bugs. Recommend a module-level `_detector_cache: dict` guarded by a lock if thread safety is needed later.

## 📚 References
- `CvResearch/main.py` — full current implementation
- `backend/transcription.py:transcribe_audio` — clean callable-function pattern to mirror
- `scripts/similarity_search.py:get_similar_chunks` — another example of a clean Python callable in this repo
- [MediaPipe FaceLandmarker Python API](https://ai.google.dev/mediapipe/solutions/vision/face_landmarker/python)

---

# Task 3: Enforce and document the 5-minute analysis window

## ☀️ Overview

Without a hard cap, submitting a 90-minute lecture recording would run for hours. This task enforces that analysis processes at most 5 minutes of video (configurable), starting from a caller-specified offset. Shorter videos are handled gracefully — the full available duration is analyzed, and the actual time processed is reported in the output so callers always know exactly how much was seen.

## 🔨 Technical details

**1. Files to modify**
- `CvResearch/main.py` — add duration cap logic inside `analyze_zoom_segment` (from Task 2)

**2. Logic to add**

Inside `analyze_zoom_segment`, before the sampling loop:
```python
video_duration_s = cap.get(cv2.CAP_PROP_FRAME_COUNT) / fps  # total video length
analysis_start_s = start_offset_s
analysis_end_s = min(analysis_start_s + max_duration_s, video_duration_s)
effective_duration_s = analysis_end_s - analysis_start_s
```

Pass `analysis_start_s` and `analysis_end_s` to `_sample_frames(cap, analysis_start_s, analysis_end_s, sample_hz)`.

**3. `_sample_frames` update**
```python
def _sample_frames(cap, start_s: float, end_s: float, sample_hz: float):
    step_s = 1.0 / sample_hz
    sec = start_s
    while sec < end_s:
        cap.set(cv2.CAP_PROP_POS_MSEC, sec * 1000)
        ok, frame_bgr = cap.read()
        if not ok:
            break
        yield sec, frame_bgr
        sec += step_s
```

**4. `meta` fields to populate**
```json
"meta": {
  "max_duration_s": 300.0,
  "start_offset_s": 0.0,
  "video_duration_s": 612.4,
  "effective_duration_s": 300.0
}
```
- `video_duration_s`: total video length (may differ from `effective_duration_s` for long recordings)
- `effective_duration_s`: actual span analyzed (`min(max_duration_s, video_duration_s - start_offset_s)`)

**5. Validation / edge cases**
- If `start_offset_s >= video_duration_s`: raise `ValueError("start_offset_s exceeds video length")`.
- If `cv2.CAP_PROP_FRAME_COUNT` returns 0 or -1 (some container formats): fall back to `float("inf")` for `video_duration_s` and let the EOF break the loop; record actual sampled seconds as `effective_duration_s`.
- `max_duration_s=0` should be treated as "no cap" or raise — add an assertion: `assert max_duration_s > 0`.
- For `.mov` / variable-frame-rate files, `CAP_PROP_FRAME_COUNT / fps` can be slightly wrong. This is acceptable for a 5-minute cap (off by < 1 s).

**6. Default values to document in the README**

| Parameter | Default | Notes |
|---|---|---|
| `max_duration_s` | `300.0` | Hard cap; 5 minutes |
| `start_offset_s` | `0.0` | Start of video by default |
| `sample_hz` | `1.0` | 1 sample per second |

## 📚 References
- `CvResearch/main.py:119–157` — current sampling loop to refactor
- `cv2.CAP_PROP_FRAME_COUNT`, `cv2.CAP_PROP_FPS` — OpenCV docs on video properties
- `CvResearch/README.md` — current benchmarks to update with duration-cap note
- [OpenCV VideoCapture properties](https://docs.opencv.org/4.x/d4/d15/group__videoio__flags__base.html)

---

# Task 4: Session-level aggregates for lecture analytics

## ☀️ Overview

Raw per-second samples are useful for debugging but not for feedback. This task computes summary statistics over the full analysis window — what fraction of the time the instructor was on screen, which facial expressions dominated the session, and whether the instructor was physically present. These aggregates are what the feedback LLM will consume to comment on presence, energy, and delivery.

## 🔨 Technical details

**1. Files to modify**
- `CvResearch/main.py` — add `_compute_aggregates(samples: list[dict]) -> dict` function

**2. Function signature**
```python
def _compute_aggregates(samples: list[dict]) -> dict:
```
Called at the end of `analyze_zoom_segment`, result stored under `result["aggregates"]`.

**3. Metrics to compute**

```python
{
  "face_visibility_ratio": 0.93,          # fraction of samples with has_face=True
  "pose_visibility_ratio": 0.88,          # fraction of samples with has_pose=True
  "blendshape_means": {                   # mean score across all frames where face present
    "mouthSmile_L": 0.14,
    "mouthSmile_R": 0.13,
    "browInnerUp": 0.06
    # ... all 52 keys
  },
  "top_blendshapes": [                    # top-5 by mean score
    {"name": "mouthSmile_L", "mean": 0.14},
    {"name": "mouthSmile_R", "mean": 0.13}
  ],
  "sample_count": 300,
  "face_sample_count": 279
}
```

**4. Implementation notes**

```python
def _compute_aggregates(samples):
    n = len(samples)
    if n == 0:
        return {}

    face_samples = [s for s in samples if s["has_face"]]
    pose_samples = [s for s in samples if s["has_pose"]]

    # blendshape means — average across face-visible frames only
    blendshape_sums: dict[str, float] = {}
    for s in face_samples:
        for k, v in s.get("blendshapes", {}).items():
            blendshape_sums[k] = blendshape_sums.get(k, 0.0) + v
    nf = len(face_samples) or 1
    blendshape_means = {k: v / nf for k, v in blendshape_sums.items()}
    top_k = sorted(blendshape_means.items(), key=lambda x: -x[1])[:5]

    return {
        "face_visibility_ratio": len(face_samples) / n,
        "pose_visibility_ratio": len(pose_samples) / n,
        "blendshape_means": blendshape_means,
        "top_blendshapes": [{"name": k, "mean": round(v, 4)} for k, v in top_k],
        "sample_count": n,
        "face_sample_count": len(face_samples),
    }
```

**5. Edge cases / notes**
- If `face_samples` is empty (no face detected at all), `blendshape_means` and `top_blendshapes` will be empty dicts/lists. Callers should check `face_visibility_ratio == 0` before interpreting expression data.
- Blendshapes map is only populated after Task 1 (FaceLandmarker). If OpenCV fallback is active, `blendshapes` will be `{}` for every sample; aggregates degrade gracefully to empty blendshape dicts.
- `top_k=5` is a reasonable default; make it a parameter of `_compute_aggregates` if callers need flexibility.
- **Assumption:** Pose metrics are limited to presence ratio for now. Finer upper-body metrics (shoulder angle, head tilt) require landmark geometry and are out of scope for this task.
- **Open question:** Should per-second blendshape time series be retained in `samples` or dropped to reduce payload size? Recommend retaining in `samples` and summarizing in `aggregates`; callers can discard `samples` if storage is a concern.

## 📚 References
- `CvResearch/main.py:148–155` — current `rows.append(...)` shape to build aggregates from
- Task 1 deliverable — blendshape keys come from `face_res.face_blendshapes[0]`
- Task 2 deliverable — `analyze_zoom_segment` return schema
- [ARKit blendshape reference](https://developer.apple.com/documentation/arkit/arfaceanchor/blendshapelocation) — canonical names

---

# Task 5: Reproducible package + smoke validation

## ☀️ Overview

A new contributor cannot currently run `CvResearch/main.py` without guessing dependencies. This task pins all Python dependencies in a `requirements.txt`, rewrites the README with a minimal runbook (install → run → expected output), and adds a smoke test that verifies any refactored output always contains the three required top-level keys: `meta`, `samples`, and `aggregates`.

## 🔨 Technical details

**1. Files to create / modify**

| File | Action |
|---|---|
| `CvResearch/requirements.txt` | Create — pin all deps |
| `CvResearch/README.md` | Rewrite — add runbook section |
| `CvResearch/tests/__init__.py` | Create — empty, marks package |
| `CvResearch/tests/test_smoke.py` | Create — smoke test |

**2. `CvResearch/requirements.txt`**

```
mediapipe>=0.10.14
opencv-python>=4.9.0
```
- No transitive pins needed here; `mediapipe` pulls numpy. If strict reproducibility is required, generate a full lockfile with `pip-compile` and commit `requirements.in` + `requirements.txt`.
- Do **not** add `matplotlib` — it was excluded from imports and only `MPLCONFIGDIR` is set.

**3. `CvResearch/README.md` runbook section to add**

````markdown
## Quickstart

```bash
cd CvResearch
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python main.py path/to/video.mp4
```

Models are downloaded automatically to `models/` on first run (~3–10 MB total).
Override model paths with env vars: `MP_FACE_LANDMARKER_PATH`, `MP_POSE_MODEL_PATH`.

## Running tests

```bash
pytest tests/
```
````

**4. `CvResearch/tests/test_smoke.py`**

```python
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
```

- Uses `example_video.mp4` already in the repo; swap for `example_video3.mov` if `.mp4` is unavailable.
- Relies on Task 2's `__main__` CLI wrapper emitting JSON to stdout.
- `timeout=120` is generous for a 5-minute cap at 1 fps on CPU.

**5. Edge cases / notes**
- The test spawns a subprocess rather than importing `analyze_zoom_segment` directly, to avoid model initialization at test-collection time. If the model download is flaky in CI, guard with `pytest.mark.skipif(not EXAMPLE_VIDEO.exists(), reason="no test video")`.
- `example_video.mp4` and `.mov` files should be in `.gitignore` if they are large; the test should be skippable in CI environments without test assets.
- **Open question:** Should models be committed to the repo or downloaded at test time? Downloading keeps the repo small but requires network access in CI. Recommend downloading and caching via a pytest fixture that calls `ensure_model` directly.
- Add `pytest` to `requirements.txt` under a `[dev]` extras marker or a separate `requirements-dev.txt`.

## 📚 References
- `CvResearch/main.py:38–49` — `ensure_model` pattern; call directly in a pytest fixture to pre-warm models before tests
- `CvResearch/README.md` — current benchmark content to preserve
- `backend/requirements.txt` — existing `requirements.txt` pattern in the repo
- `scripts/test_similarity.py` — existing test script pattern (subprocess-style) to mirror
- [pytest docs](https://docs.pytest.org/en/stable/)
- [pip-tools for lockfiles](https://pip-tools.readthedocs.io/en/latest/)
