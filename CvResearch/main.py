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


def analyze_zoom_segment(video_path: str) -> dict:
    t0 = time.perf_counter()
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)

    backend, face_det, pose_det, setup_error = create_detectors()

    sec = 0
    samples = []
    annotated_images = []

    while True:
        cap.set(cv2.CAP_PROP_POS_MSEC, sec * 1000)
        ok, frame_bgr = cap.read()
        if not ok:
            break

        t_frame0 = time.perf_counter()
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        annotated = frame_bgr.copy()

        if backend == "tasks":
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)
            face_res = face_det.detect(mp_image)
            pose_res = pose_det.detect(mp_image)
            has_face = bool(face_res.detections)
            has_pose = bool(pose_res.pose_landmarks)
            if has_pose:
                draw_pose_landmarks(annotated, pose_res.pose_landmarks[0])
        else:
            gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
            face_boxes = face_det.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5)
            pose_boxes, _ = pose_det.detectMultiScale(
                frame_bgr, winStride=(8, 8), padding=(8, 8), scale=1.05
            )
            has_face = len(face_boxes) > 0
            has_pose = len(pose_boxes) > 0
            for (x, y, w, h) in pose_boxes:
                cv2.rectangle(annotated, (x, y), (x + w, y + h), (0, 255, 0), 2)

        t_frame1 = time.perf_counter()

        samples.append(
            {
                "sec": sec,
                "frame_ms": (t_frame1 - t_frame0) * 1000,
                "has_face": has_face,
                "has_pose": has_pose,
            }
        )
        annotated_images.append(annotated)
        sec += 1

    if backend == "tasks":
        face_det.close()
        pose_det.close()
    cap.release()

    t1 = time.perf_counter()

    return {
        "samples": samples,
        "aggregates": _compute_aggregates(samples),
        "annotated_images": annotated_images,
        "backend": backend,
        "setup_error": setup_error,
        "fps": fps,
        "total_time_s": t1 - t0,
    }


if __name__ == "__main__":
    result = analyze_zoom_segment("example_video3.mov")

    samples = result["samples"]
    aggregates = result["aggregates"]

    print(f"backend={result['backend']} sampled_seconds={len(samples)} total_time={result['total_time_s']:.3f}s")
    print(f"annotated_images_count={len(result['annotated_images'])}")
    print(f"face_visibility_ratio={aggregates.get('face_visibility_ratio', 'n/a'):.2f}")
    print(f"pose_visibility_ratio={aggregates.get('pose_visibility_ratio', 'n/a'):.2f}")
    print(f"top_blendshapes={aggregates.get('top_blendshapes', [])}")

    for i, im in enumerate(result["annotated_images"]):
        cv2.imwrite(f"img{i}.png", im)

    if result["setup_error"]:
        print(f"tasks_setup_error={result['setup_error']}")
