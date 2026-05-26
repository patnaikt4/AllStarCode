# Computer Vision Analysis (`CvResearch/main.py`)

This document covers the Python computer vision module that analyzes instructor videos for physical presence and facial expression data. It is called by the TypeScript feedback pipeline via subprocess — see [video-analysis.md](./video-analysis.md) for how it integrates. For the implementation task plans that guided its development, see [cv-implementation-plan.md](./cv-implementation-plan.md).

---

## Overview

`CvResearch/main.py` is a standalone Python module that samples frames from a video, runs face and pose detection on each frame, and returns structured JSON with per-frame samples and session-level aggregates.

The module is designed to be used in two ways:

**From the command line:**
```bash
python CvResearch/main.py path/to/video.mp4
```
Prints the full JSON result to stdout.

**As an imported module:**
```python
from CvResearch.main import analyze_zoom_segment

result = analyze_zoom_segment(
    "path/to/video.mp4",
    max_duration_s=300,
    sample_hz=1.0,
    start_offset_s=0.0,
)
```

When used from the TypeScript backend, `analyzeVideoCV` in `apps/web/lib/feedback/analyze-video-cv.ts` calls it via `execFileAsync` with the video path as a CLI argument and reads the JSON from stdout.

---

## Public API

### `analyze_zoom_segment`

```python
def analyze_zoom_segment(
    video_path: Union[str, Path],
    *,
    max_duration_s: float = 300.0,
    sample_hz: float = 1.0,
    start_offset_s: float = 0.0,
) -> dict:
```

| Parameter | Default | Description |
|---|---|---|
| `video_path` | required | Path to the video file |
| `max_duration_s` | `300.0` | Maximum seconds to analyze (caps analysis at 5 minutes by default) |
| `sample_hz` | `1.0` | Frames sampled per second. `1.0` = one per second, `2.0` = two per second |
| `start_offset_s` | `0.0` | Start time in seconds (analyze from a specific point in the video) |

**Returns:** A dict with `meta`, `samples`, and `aggregates` keys (see Return schema below).

**Resource cleanup:** Uses `try/finally` to always release the OpenCV `VideoCapture` handle and close MediaPipe detectors, even if analysis fails partway through.

---

## Return schema

### `meta`

Video-level metadata about what was analyzed and how long it took.

```json
{
  "meta": {
    "video_path": "example_video.mov",
    "backend": "tasks",
    "fps": 25.32,
    "effective_duration_s": 40.2,
    "sample_hz": 1.0,
    "sample_count": 40,
    "total_wall_s": 8.28,
    "setup_error": ""
  }
}
```

| Field | Description |
|---|---|
| `backend` | `"tasks"` if MediaPipe Tasks loaded successfully, `"opencv"` if fallback was used |
| `effective_duration_s` | Actual analyzed duration: `min(max_duration_s, video_duration - start_offset_s)` |
| `setup_error` | Non-empty string if detector initialization had a warning (analysis still continues) |

### `samples`

One object per sampled frame, in chronological order.

```json
{
  "samples": [
    {
      "sec": 0.0,
      "frame_ms": 26.03,
      "has_face": true,
      "has_pose": true,
      "blendshapes": {}
    }
  ]
}
```

| Field | Description |
|---|---|
| `sec` | Timestamp in seconds where this frame was sampled |
| `frame_ms` | Time in milliseconds to process this frame |
| `has_face` | Whether a face was detected in this frame |
| `has_pose` | Whether a body pose was detected in this frame |
| `blendshapes` | Dict of ARKit blendshape name → score (0.0–1.0). Currently `{}` until FaceLandmarker is integrated; see note below |

### `aggregates`

Session-level statistics computed from the full samples list.

```json
{
  "aggregates": {
    "face_visibility_ratio": 0.93,
    "pose_visibility_ratio": 0.88,
    "blendshape_means": {
      "mouthSmile_L": 0.14,
      "mouthSmile_R": 0.13,
      "browInnerUp": 0.06
    },
    "top_blendshapes": [
      { "name": "mouthSmile_L", "mean": 0.14 },
      { "name": "mouthSmile_R", "mean": 0.13 }
    ],
    "sample_count": 300,
    "face_sample_count": 279
  }
}
```

| Field | Description |
|---|---|
| `face_visibility_ratio` | Fraction of samples where `has_face = true` |
| `pose_visibility_ratio` | Fraction of samples where `has_pose = true` |
| `blendshape_means` | Mean score per blendshape key, averaged across only face-visible frames |
| `top_blendshapes` | Top 5 blendshapes by mean score, sorted descending |
| `sample_count` | Total frames sampled |
| `face_sample_count` | Frames where a face was detected |

When no face is detected (`face_visibility_ratio = 0`), `blendshape_means` and `top_blendshapes` are empty. Callers should check `face_visibility_ratio` before interpreting expression data.

---

## Internal helper functions

| Function | Responsibility |
|---|---|
| `ensure_model(model_path, model_url)` | Checks if a model file exists locally; downloads it if missing |
| `create_detectors()` | Initializes MediaPipe Tasks detectors (FaceDetector, PoseLandmarker). Falls back to OpenCV CascadeClassifier if MediaPipe Tasks is unavailable. Returns `(backend, face, pose, setup_error)` |
| `_load_video(path)` | Opens the video with OpenCV `VideoCapture`. Raises `ValueError` if the file cannot be opened. Returns `(cap, fps)` |
| `_sample_frames(cap, start_s, end_s, sample_hz)` | Generator that seeks to each sample position and yields `(sec, frame_bgr)` |
| `_process_frame(frame_bgr, backend, face, pose)` | Runs detection on one frame. Returns `(has_face, has_pose, blendshapes, frame_ms)` |
| `_compute_aggregates(samples)` | Computes `face_visibility_ratio`, `pose_visibility_ratio`, `blendshape_means`, and `top_blendshapes` from the samples list |

---

## Detection backends

The module tries to load MediaPipe Tasks detectors on startup. If that fails (e.g., `mediapipe` is not installed or the model files are missing), it falls back to OpenCV's built-in CascadeClassifier.

| Backend | Face detection | Pose detection | Blendshapes |
|---|---|---|---|
| `tasks` (MediaPipe) | FaceDetector `.tflite` model | PoseLandmarker `.task` model | Reserved (not yet populated) |
| `opencv` (fallback) | Haar CascadeClassifier | *(same MediaPipe pose if available)* | Not available |

**Model files** are stored in `CvResearch/models/` and downloaded automatically on first run via `ensure_model`:
- `blaze_face_short_range.tflite` — MediaPipe face detection model
- `pose_landmarker_lite.task` — MediaPipe pose landmark model

---

## FaceLandmarker / blendshapes note

The current implementation uses **MediaPipe FaceDetector**, which detects whether a face is present but does not return blendshape coefficients. As a result, `blendshapes` is always `{}` in the current output and `blendshape_means` / `top_blendshapes` are always empty.

The schema is intentionally kept in place so that when **MediaPipe FaceLandmarker** is wired in (see [cv-implementation-plan.md](./cv-implementation-plan.md), Task 1), it can populate the blendshape fields without any change to the output format or downstream consumers.

---

## `_compute_aggregates` details

```python
def _compute_aggregates(samples: list[dict]) -> dict:
```

Called once at the end of `analyze_zoom_segment` with the completed samples list.

**Algorithm:**

1. Filter `face_samples = [s for s in samples if s["has_face"]]`
2. Filter `pose_samples = [s for s in samples if s["has_pose"]]`
3. For each face-visible sample, accumulate blendshape scores by key
4. Divide each accumulated score by `len(face_samples)` to get per-key means
5. Sort means descending and take the top 5 as `top_blendshapes`
6. Return ratios, means, and raw counts

**Verification check:** `face_sample_count / sample_count` should equal `face_visibility_ratio` exactly — both derive from the same integer count.

---

## Dependencies

```
mediapipe>=0.10.14
opencv-python>=4.9.0
```

Install with:
```bash
cd CvResearch
pip install -r requirements.txt
```

---

## Testing

**CLI smoke test:**
```bash
python CvResearch/main.py CvResearch/example_video3.mov
```
Should print valid JSON to stdout with `meta`, `samples`, and `aggregates` keys.

**Import test** — importing the module should not start analysis, open any video files, create detectors, or write files:
```python
from CvResearch.main import analyze_zoom_segment
# No side effects at import time
```

**Short analysis test:**
```python
result = analyze_zoom_segment("CvResearch/example_video3.mov", max_duration_s=5)
assert "meta" in result
assert "samples" in result
assert "aggregates" in result
assert result["meta"]["sample_count"] == len(result["samples"])
```

**Aggregate math check:** `face_visibility_ratio` should equal `face_sample_count / sample_count`. All `blendshape_means` values should be in `[0.0, 1.0]`. `top_blendshapes` should be sorted strictly descending and contain at most 5 entries.
