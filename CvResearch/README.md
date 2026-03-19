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