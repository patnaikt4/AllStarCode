import os
import time
import urllib.request
from pathlib import Path
from typing import Union

os.environ.setdefault("MPLCONFIGDIR", str((Path.cwd() / ".mplconfig").resolve()))

import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.vision import pose_landmarker


MODEL_DIR = Path(os.environ.get("MP_MODEL_DIR", "models"))
MODEL_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_FACE_LANDMARKER_PATH = MODEL_DIR / "face_landmarker.task"
DEFAULT_POSE_MODEL_PATH = MODEL_DIR / "pose_landmarker_lite.task"

FACE_LANDMARKER_PATH = Path(
    os.environ.get("MP_FACE_LANDMARKER_PATH", str(DEFAULT_FACE_LANDMARKER_PATH))
)
POSE_MODEL_PATH = Path(
    os.environ.get("MP_POSE_MODEL_PATH", str(DEFAULT_POSE_MODEL_PATH))
)

FACE_LANDMARKER_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/1/face_landmarker.task"
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
        ensure_model(FACE_LANDMARKER_PATH, FACE_LANDMARKER_URL)
        ensure_model(POSE_MODEL_PATH, POSE_MODEL_URL)

        face_options = vision.FaceLandmarkerOptions(
            base_options=python.BaseOptions(
                model_asset_path=str(FACE_LANDMARKER_PATH),
                delegate=python.BaseOptions.Delegate.CPU,
            ),
            running_mode=vision.RunningMode.IMAGE,
            output_face_blendshapes=True,
            min_face_detection_confidence=0.5,
            min_face_presence_confidence=0.5,
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

        face = vision.FaceLandmarker.create_from_options(face_options)
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


def _compute_aggregates(samples: list[dict], top_k: int = 5) -> dict:
    n = len(samples)
    if n == 0:
        return {}

    face_samples = [s for s in samples if s["has_face"]]
    pose_samples = [s for s in samples if s["has_pose"]]

    blendshape_sums: dict[str, float] = {}
    for s in face_samples:
        for k, v in s.get("blendshapes", {}).items():
            blendshape_sums[k] = blendshape_sums.get(k, 0.0) + v
    nf = len(face_samples) or 1
    blendshape_means = {k: v / nf for k, v in blendshape_sums.items()}
    top = sorted(blendshape_means.items(), key=lambda x: -x[1])[:top_k]

    return {
        "face_visibility_ratio": len(face_samples) / n,
        "pose_visibility_ratio": len(pose_samples) / n,
        "blendshape_means": blendshape_means,
        "top_blendshapes": [{"name": k, "mean": round(v, 4)} for k, v in top],
        "sample_count": n,
        "face_sample_count": len(face_samples),
    }


def _load_video(path: Union[str, Path]):
    path = Path(path)
    cap = cv2.VideoCapture(str(path))

    if not cap.isOpened():
        raise ValueError(f"Could not open video: {path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 0.0

    return cap, fps


def _sample_frames(cap, start_s: float, end_s: float, sample_hz: float):
    """Yield (timestamp_s, frame_bgr) tuples within [start_s, end_s)."""
    if sample_hz <= 0:
        raise ValueError("sample_hz must be > 0")

    step_s = 1.0 / sample_hz
    sec = start_s

    while sec < end_s:
        cap.set(cv2.CAP_PROP_POS_MSEC, sec * 1000.0)

        ok, frame_bgr = cap.read()
        if not ok or frame_bgr is None:
            break

        yield sec, frame_bgr
        sec += step_s


def _process_frame(frame_bgr, backend, face, pose):
    t_frame0 = time.perf_counter()

    blendshapes = {}
    annotated = frame_bgr.copy()

    if backend == "tasks":
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)

        face_res = face.detect(mp_image)
        pose_res = pose.detect(mp_image)

        has_face = bool(face_res.face_landmarks)
        has_pose = bool(pose_res.pose_landmarks)

        if has_pose:
            draw_pose_landmarks(annotated, pose_res.pose_landmarks[0])

        blendshapes = (
            {b.category_name: b.score for b in face_res.face_blendshapes[0]}
            if face_res.face_blendshapes else {}
        )

    else:
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)

        face_boxes = face.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=5,
        )

        pose_boxes, _ = pose.detectMultiScale(
            frame_bgr,
            winStride=(8, 8),
            padding=(8, 8),
            scale=1.05,
        )

        has_face = len(face_boxes) > 0
        has_pose = len(pose_boxes) > 0
        blendshapes = {}

        for (x, y, w, h) in pose_boxes:
            cv2.rectangle(annotated, (x, y), (x + w, y + h), (0, 255, 0), 2)

    t_frame1 = time.perf_counter()
    frame_ms = (t_frame1 - t_frame0) * 1000.0

    return has_face, has_pose, blendshapes, frame_ms, annotated


def analyze_zoom_segment(
    video_path: Union[str, Path],
    *,
    max_duration_s: float = 300.0,
    start_offset_s: float = 0.0,
    sample_hz: float = 1.0,
) -> dict:
    """Analyze a video segment with a configurable duration cap.

    Parameters
    ----------
    video_path : str or Path
        Path to the video file to analyze.
    max_duration_s : float
        Hard cap on how many seconds of video to analyze (default 300 = 5 min).
    start_offset_s : float
        Where in the video to begin analysis (default 0.0 = start).
    sample_hz : float
        Frames to sample per second (default 1.0 = one frame/sec).

    Returns
    -------
    dict with keys ``meta``, ``samples``, ``aggregates``, ``annotated_images``.
    """
    if max_duration_s <= 0:
        raise ValueError("max_duration_s must be positive")
    if start_offset_s < 0:
        raise ValueError("start_offset_s must be non-negative")

    wall_start = time.perf_counter()

    video_path = Path(video_path)
    cap = None
    fps = 0.0
    backend = "unknown"
    setup_error = ""
    samples = []
    annotated_images = []
    effective_duration_s = 0.0
    video_duration_s = None

    try:
        cap, fps = _load_video(video_path)

        frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
        if frame_count > 0 and fps > 0:
            video_duration_s = frame_count / fps
        # If unknown, fall back to inf so the loop runs until EOF
        _vd = video_duration_s if video_duration_s is not None else float("inf")

        if start_offset_s >= _vd:
            raise ValueError(
                f"start_offset_s ({start_offset_s}) exceeds video length "
                f"({_vd:.1f}s)"
            )

        backend, face, pose, setup_error = create_detectors()

        start_s = max(0.0, start_offset_s)
        end_s = min(_vd, start_s + max_duration_s)
        effective_duration_s = max(0.0, end_s - start_s)

        try:
            for sec, frame_bgr in _sample_frames(cap, start_s, end_s, sample_hz):
                has_face, has_pose, blendshapes, frame_ms, annotated = _process_frame(
                    frame_bgr,
                    backend,
                    face,
                    pose,
                )

                samples.append(
                    {
                        "sec": sec,
                        "frame_ms": frame_ms,
                        "has_face": has_face,
                        "has_pose": has_pose,
                        "blendshapes": blendshapes,
                    }
                )
                annotated_images.append(annotated)

        finally:
            if backend == "tasks":
                face.close()
                pose.close()

    except Exception as exc:
        setup_error = str(exc)

    finally:
        if cap is not None:
            cap.release()

    total_wall_s = time.perf_counter() - wall_start

    return {
        "meta": {
            "video_path": str(video_path),
            "backend": backend,
            "fps": fps,
            "video_duration_s": video_duration_s,
            "effective_duration_s": round(effective_duration_s, 2),
            "max_duration_s": max_duration_s,
            "start_offset_s": start_offset_s,
            "sample_hz": sample_hz,
            "sample_count": len(samples),
            "total_wall_s": round(total_wall_s, 3),
            "setup_error": setup_error or None,
        },
        "samples": samples,
        "aggregates": _compute_aggregates(samples),
        "annotated_images": annotated_images,
    }


if __name__ == "__main__":
    import argparse
    import json
    import sys

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

    output = {k: v for k, v in result.items() if k != "annotated_images"}
    json.dump(output, sys.stdout, indent=2)
    print(f"sampled_frames={len(result['samples'])}", file=sys.stderr)

    if args.save_images:
        for i, im in enumerate(result["annotated_images"]):
            cv2.imwrite(f"img{i}.png", im)
        print(f"annotated_images_count={len(result['annotated_images'])}")
