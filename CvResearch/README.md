## Analysis Duration Cap

To prevent long recordings (e.g. 90-minute lectures) from running for hours,
`analyze_zoom_segment` enforces a configurable analysis window.

| Parameter        | Default | Notes                           |
|------------------|---------|---------------------------------|
| `max_duration_s` | 300.0   | Hard cap; 5 minutes of video    |
| `start_offset_s` | 0.0     | Where in the video to start     |
| `sample_hz`      | 1.0     | Frames sampled per second       |

The function only analyzes the window `[start_offset_s, start_offset_s + max_duration_s)`
(or until the video ends, whichever comes first). The actual time span analyzed is reported
as `effective_duration_s` in the returned `meta` dict so callers always know how much was seen.

### Usage

```bash
# Analyze the first 5 minutes (default)
python main.py lecture.mov

# Start 10 minutes in, analyze 3 minutes, save annotated frames
python main.py lecture.mov --start-offset 600 --max-duration 180 --save-images

# Programmatic usage
from main import analyze_zoom_segment
result = analyze_zoom_segment("lecture.mov", max_duration_s=120, start_offset_s=30)
print(result["meta"])  # includes effective_duration_s, video_duration_s, etc.
```

### Edge cases

- If `start_offset_s` exceeds the video length, a `ValueError` is raised.
- If the container format reports 0 frames (some `.mov` files), the cap falls back to
  reading until EOF and records the actual sampled span as `effective_duration_s`.
- `max_duration_s` must be > 0; `start_offset_s` must be >= 0.

---

## Cost Model

At 1 fps sampling, compute scales linearly with total video minutes, and linearly with the per-frame inference cost of Face Detection + Pose.
Benchmark yields a runtime factor R (CPU-seconds per video-minute) that you can plug directly into the monthly volume formula:
    X * Y * Z * 4.33. If R is low (e.g., processing faster than real time), a single commodity machine can handle substantial weekly volume;
    if R approaches or exceeds real time, you’ll either need more CPU capacity, lower the sample rate, reduce model complexity, 
    or batch work onto a small pool of machines.

Cost-wise, you can treat compute spend as proportional to monthly_cpu_hours: doubling instructors, videos/week, or minutes/video doubles cost;
halving the sampling rate (e.g., 0.5 fps) roughly halves inference workload (often close to halving runtime).
This makes the main cost levers straightforward: (1) sampling rate, (2) model complexity/settings, (3) hardware choice (CPU vs GPU),
and (4) scheduling (off-peak batch vs near-real-time).

I tried running the model on my CPU for rough benchmarks, though they will be worth little since
performance is so strongly related to processing power.

Frames Processed    Video Length(s)    Time
7                   7                  0.548
15                  15                 2.14
40                  40                 4.103