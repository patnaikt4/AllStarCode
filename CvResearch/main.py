import os
import time
import urllib.request
from pathlib import Path

os.environ.setdefault("MPLCONFIGDIR", str((Path.cwd() / ".mplconfig").resolve()))

import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.vision import pose_landmarker


MODEL_DIR = Path(os.environ.get("MP_MODEL_DIR", "models"))
MODEL_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_FACE_MODEL_PATH = MODEL_DIR / "blaze_face_short_range.tflite"
DEFAULT_POSE_MODEL_PATH = MODEL_DIR / "pose_landmarker_lite.task"

FACE_MODEL_PATH = Path(
    os.environ.get("MP_FACE_MODEL_PATH", str(DEFAULT_FACE_MODEL_PATH))
)
POSE_MODEL_PATH = Path(
    os.environ.get("MP_POSE_MODEL_PATH", str(DEFAULT_POSE_MODEL_PATH))
)

FACE_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_detector/"
    "blaze_face_short_range/float16/1/blaze_face_short_range.tflite"
)
POSE_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
)


def ensure_model(model_path: Path, model_url: str) -> None:
    if model_path.exists():
        return
    model_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        urllib.request.urlretrieve(model_url, model_path)
    except Exception as exc:
        raise RuntimeError(
            f"Could not download model {model_path.name} from {model_url}. "
            "Set the corresponding MP_*_MODEL_PATH environment variable "
            "to a local pretrained model file."
        ) from exc


def create_detectors():
    try:
        ensure_model(FACE_MODEL_PATH, FACE_MODEL_URL)
        ensure_model(POSE_MODEL_PATH, POSE_MODEL_URL)

        face_options = vision.FaceDetectorOptions(
            base_options=python.BaseOptions(
                model_asset_path=str(FACE_MODEL_PATH),
                delegate=python.BaseOptions.Delegate.CPU,
            ),
            min_detection_confidence=0.5,
        )
        pose_options = vision.PoseLandmarkerOptions(
            base_options=python.BaseOptions(
                model_asset_path=str(POSE_MODEL_PATH),
                delegate=python.BaseOptions.Delegate.CPU,
            ),
            running_mode=vision.RunningMode.IMAGE,
            min_pose_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )

        face = vision.FaceDetector.create_from_options(face_options)
        pose = vision.PoseLandmarker.create_from_options(pose_options)
        return "tasks", face, pose, ""
    except Exception as exc:
        # Some macOS/headless builds fail to initialize Task graphs due to GL
        # service requirements. Fall back to OpenCV pretrained detectors.
        face = cv2.CascadeClassifier(
            str(Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml")
        )
        pose = cv2.HOGDescriptor()
        pose.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
        if face.empty():
            raise RuntimeError("OpenCV face cascade failed to load.") from exc
        return "opencv", face, pose, str(exc)


POSE_CONNECTIONS = pose_landmarker.PoseLandmarksConnections.POSE_LANDMARKS


def draw_pose_landmarks(image_bgr, pose_landmarks):
    height, width = image_bgr.shape[:2]
    for connection in POSE_CONNECTIONS:
        start_lm = pose_landmarks[connection.start]
        end_lm = pose_landmarks[connection.end]
        if start_lm.visibility < 0.5 or end_lm.visibility < 0.5:
            continue
        start_xy = (int(start_lm.x * width), int(start_lm.y * height))
        end_xy = (int(end_lm.x * width), int(end_lm.y * height))
        cv2.line(image_bgr, start_xy, end_xy, (0, 255, 0), 2)

    for landmark in pose_landmarks:
        if landmark.visibility < 0.5:
            continue
        point = (int(landmark.x * width), int(landmark.y * height))
        cv2.circle(image_bgr, point, 3, (0, 140, 255), -1)

def _sample_frames(cap, start_s: float, end_s: float, sample_hz: float):
    """Yield (timestamp_s, frame_bgr) tuples within [start_s, end_s)."""
    step_s = 1.0 / sample_hz
    sec = start_s
    while sec < end_s:
        cap.set(cv2.CAP_PROP_POS_MSEC, sec * 1000)
        ok, frame_bgr = cap.read()
        if not ok:
            break
        yield sec, frame_bgr
        sec += step_s


def analyze_zoom_segment(
    video_path: str,
    *,
    max_duration_s: float = 300.0,
    start_offset_s: float = 0.0,
    sample_hz: float = 1.0,
) -> dict:
    """Analyze a video segment with a configurable duration cap.

    Parameters
    ----------
    video_path : str
        Path to the video file to analyze.
    max_duration_s : float
        Hard cap on how many seconds of video to analyze (default 300 = 5 min).
    start_offset_s : float
        Where in the video to begin analysis (default 0.0 = start).
    sample_hz : float
        Frames to sample per second (default 1.0 = one frame/sec).

    Returns
    -------
    dict with keys ``rows``, ``annotated_images``, ``meta``.
    """
    assert max_duration_s > 0, "max_duration_s must be positive"
    assert start_offset_s >= 0, "start_offset_s must be non-negative"
    assert sample_hz > 0, "sample_hz must be positive"

    t0 = time.perf_counter()
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0  # fallback if fps == 0

    # ── compute the analysis window ──────────────────────────
    frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
    if frame_count <= 0:
        # Some container formats (.mov, streams) report 0 or -1.
        # Fall back to inf and let the EOF break the loop.
        video_duration_s = float("inf")
    else:
        video_duration_s = frame_count / fps

    if start_offset_s >= video_duration_s:
        cap.release()
        raise ValueError(
            f"start_offset_s ({start_offset_s}) exceeds video length "
            f"({video_duration_s:.1f}s)"
        )

    analysis_start_s = start_offset_s
    analysis_end_s = min(analysis_start_s + max_duration_s, video_duration_s)
    # ─────────────────────────────────────────────────────────

    backend, face, pose, setup_error = create_detectors()

    rows = []
    annotated_images = []
    last_sec = analysis_start_s  # track actual last sampled timestamp

    for sec, frame_bgr in _sample_frames(cap, analysis_start_s, analysis_end_s, sample_hz):
        t_frame0 = time.perf_counter()
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        annotated = frame_bgr.copy()
        if backend == "tasks":
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)
            face_res = face.detect(mp_image)
            pose_res = pose.detect(mp_image)
            has_face = bool(face_res.detections)
            has_pose = bool(pose_res.pose_landmarks)
            if has_pose:
                draw_pose_landmarks(annotated, pose_res.pose_landmarks[0])
        else:
            gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
            face_boxes = face.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5)
            pose_boxes, _ = pose.detectMultiScale(
                frame_bgr, winStride=(8, 8), padding=(8, 8), scale=1.05
            )
            has_face = len(face_boxes) > 0
            has_pose = len(pose_boxes) > 0
            for (x, y, w, h) in pose_boxes:
                cv2.rectangle(annotated, (x, y), (x + w, y + h), (0, 255, 0), 2)
        t_frame1 = time.perf_counter()

        rows.append(
            {
                "sec": sec,
                "frame_ms": (t_frame1 - t_frame0) * 1000,
                "has_face": has_face,
                "has_pose": has_pose,
            }
        )
        annotated_images.append(annotated)
        last_sec = sec

    if backend == "tasks":
        face.close()
        pose.close()
    cap.release()

    # If video_duration_s was inf (unknown), compute from what we actually saw
    if video_duration_s == float("inf") and rows:
        effective_duration_s = last_sec - analysis_start_s + (1.0 / sample_hz)
    else:
        effective_duration_s = analysis_end_s - analysis_start_s

    t1 = time.perf_counter()

    meta = {
        "max_duration_s": max_duration_s,
        "start_offset_s": start_offset_s,
        "video_duration_s": video_duration_s if video_duration_s != float("inf") else None,
        "effective_duration_s": round(effective_duration_s, 2),
        "sample_hz": sample_hz,
        "backend": backend,
        "wall_time_s": round(t1 - t0, 3),
        "setup_error": setup_error or None,
    }

    return {
        "rows": rows,
        "annotated_images": annotated_images,
        "meta": meta,
    }


# ── CLI entry point ──────────────────────────────────────────
if __name__ == "__main__":
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Analyze a video segment")
    parser.add_argument("video", help="Path to the video file")
    parser.add_argument("--max-duration", type=float, default=300.0,
                        help="Max seconds to analyze (default: 300)")
    parser.add_argument("--start-offset", type=float, default=0.0,
                        help="Start offset in seconds (default: 0)")
    parser.add_argument("--sample-hz", type=float, default=1.0,
                        help="Frames per second to sample (default: 1)")
    parser.add_argument("--save-images", action="store_true",
                        help="Write annotated frames as img0.png, img1.png, …")
    args = parser.parse_args()

    result = analyze_zoom_segment(
        args.video,
        max_duration_s=args.max_duration,
        start_offset_s=args.start_offset,
        sample_hz=args.sample_hz,
    )

    meta = result["meta"]
    rows = result["rows"]
    print(json.dumps(meta, indent=2))
    print(f"sampled_frames={len(rows)}")

    if args.save_images:
        for i, im in enumerate(result["annotated_images"]):
            cv2.imwrite(f"img{i}.png", im)
        print(f"annotated_images_count={len(result['annotated_images'])}")
