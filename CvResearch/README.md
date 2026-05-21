## Quickstart

```bash
cd CvResearch
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
python main.py path/to/video.mp4
```

Models are downloaded automatically to `models/` on first run (~3–10 MB total).
Override model paths with env vars: `MP_FACE_MODEL_PATH`, `MP_POSE_MODEL_PATH`.

## Running tests

```bash
pytest tests/
```